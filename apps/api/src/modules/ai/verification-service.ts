import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { MobileRepository } from "../../database/repositories/mobile-repository.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import type { VerificationDetail } from "@itms/types";
import type { CorridorService } from "../corridor/corridor-service.ts";
import { AppError } from "../../errors.ts";

export interface VerificationAnalyzeInput {
  requestId: string;
  eventId: number;
  driverId?: number | null;
  vehicleId?: number | null;
  capturedPhotoPath: string;
  scenario?: string; // "scenarioA" | "scenarioB" | "scenarioC"
  notes?: string;
  patientCondition?: string;
}

export class AiVerificationService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly mobileRepo: MobileRepository;
  private readonly bus: WsBus;
  private readonly corridorService?: CorridorService;

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    mobileRepo: MobileRepository;
    bus: WsBus;
    corridorService?: CorridorService;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.mobileRepo = options.mobileRepo;
    this.bus = options.bus;
    this.corridorService = options.corridorService;
  }

  async processVerification(input: VerificationAnalyzeInput): Promise<VerificationDetail> {
    this.logger.info("Emergency photo captured; flagging for webapp manual approval", {
      requestId: input.requestId,
      eventId: input.eventId,
      scenario: input.scenario,
    });

    // 1. Initial State: Submitted
    await this.mobileRepo.createOrUpdateVerification({
      requestId: input.requestId,
      eventId: input.eventId,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      status: "submitted",
      isCorridorAuthorized: false,
    });

    this.bus.broadcast("emergency:verification:submitted", {
      requestId: input.requestId,
      eventId: input.eventId,
      status: "submitted",
    });

    const verification = await this.mobileRepo.getVerificationByRequestId(input.requestId);
    if (!verification) {
      throw new AppError(500, "verification_lost", "Verification session record disappeared.");
    }

    // 2. All captured images are flagged for manual review and approval from the webapp
    const verdict: "VERIFIED" | "FRAUD_FLAGGED" | "REVIEW_REQUIRED" = "REVIEW_REQUIRED";
    const confidenceScore = 1.0;
    const reason = "Captured image flagged. Mandatory review & approval required from the ITMS Webapp Control Center before corridor activation and trip start.";
    const detectedFeatures = [
      "Evidence image captured and flagged",
      "Held for webapp operator authorization",
      "Green corridor held pending manual approval",
    ];
    const isFlaggedAsFraud = true;
    const model = "manual_supervisor_gating";

    // 3. Save flagged result
    await this.mobileRepo.recordAiResult({
      verificationId: verification.id,
      verdict,
      confidenceScore,
      reason,
      detectedFeatures,
      isFlaggedAsFraud,
      model,
      source: "manual_supervisor_gating",
    });

    await this.mobileRepo.recordAudit(
      "photo_captured_flagged",
      String(input.driverId ?? "system"),
      "system",
      input.eventId,
      { verdict, confidenceScore, model, isFlaggedAsFraud, reason },
    );

    // 4. Update Verification Lifecycle to manualReview with corridor UNAUTHORIZED
    await this.mobileRepo.updateVerificationStatus(verification.id, "manualReview", false);

    this.bus.broadcast("emergency:fraud-flagged", {
      requestId: input.requestId,
      eventId: input.eventId,
      verdict: "REVIEW_REQUIRED",
      confidence: confidenceScore,
      reason,
      isCorridorAuthorized: false,
    });

    this.bus.broadcast("emergency:manual-review", {
      requestId: input.requestId,
      eventId: input.eventId,
      reason,
      isCorridorAuthorized: false,
      status: "manualReview",
      timestamp: new Date().toISOString(),
    });

    const updated = await this.mobileRepo.getVerificationByRequestId(input.requestId);
    return updated!;
  }

  // ------------------------------------------------ MANUAL ADMIN REVIEW ----
  async adminApprove(
    verificationId: number,
    reviewerId: string,
    reviewerName: string,
    notes?: string,
  ): Promise<VerificationDetail> {
    const list = await this.mobileRepo.listVerifications();
    const target = list.find((v) => v.id === verificationId || v.eventId === verificationId);
    if (!target) {
      throw new AppError(404, "verification_not_found", `Verification record #${verificationId} not found.`);
    }

    if (
      target.status !== "manualReview" &&
      target.status !== "submitted" &&
      target.status !== "aiAnalyzing" &&
      target.status !== "aiFraudFlagged"
    ) {
      throw new AppError(409, "invalid_state_transition", `Cannot approve verification in state ${target.status}.`);
    }

    await this.mobileRepo.adminApproveTransaction({
      verificationId: target.id,
      reviewerId,
      reviewerName,
      notes: notes ?? "Authorized by Traffic Operations Supervisor via Webapp.",
    });

    // Automatically activate the Green Corridor upon admin approval
    if (this.corridorService) {
      try {
        await this.corridorService.createCorridor(target.eventId);
        this.logger.info("[CORRIDOR_CREATED] Green corridor activated on Admin approval from webapp", { eventId: target.eventId });
      } catch (err) {
        this.logger.warn("[CORRIDOR_CREATE_DEFERRED] Corridor creation on admin approve deferred", { eventId: target.eventId, error: err });
      }
    }

    await this.mobileRepo.recordAudit(
      "admin_verification_approved",
      reviewerId,
      "admin",
      target.eventId,
      { reviewerName, notes },
    );

    this.bus.broadcast("emergency:approved", {
      requestId: target.requestId,
      eventId: target.eventId,
      reviewerName,
      isCorridorAuthorized: true,
    });

    this.bus.broadcast("corridor:authorized", {
      eventId: target.eventId,
      emergencyId: target.eventId,
      corridorId: null,
      requestId: target.requestId,
      authorizedBy: reviewerName,
      status: "AUTHORIZED",
      timestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = await this.mobileRepo.getVerificationByRequestId(target.requestId);
    return updated!;
  }

  async adminReject(
    verificationId: number,
    reviewerId: string,
    reviewerName: string,
    rejectionReason: string,
  ): Promise<VerificationDetail> {
    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new AppError(400, "reason_required", "A specific rejection reason is mandatory.");
    }

    const list = await this.mobileRepo.listVerifications();
    const target = list.find((v) => v.id === verificationId || v.eventId === verificationId);
    if (!target) {
      throw new AppError(404, "verification_not_found", `Verification record #${verificationId} not found.`);
    }

    if (target.status !== "manualReview" && target.status !== "submitted" && target.status !== "aiAnalyzing") {
      throw new AppError(409, "invalid_state_transition", `Cannot reject verification in state ${target.status}.`);
    }

    await this.mobileRepo.adminRejectTransaction({
      verificationId: target.id,
      reviewerId,
      reviewerName,
      rejectionReason: rejectionReason.trim(),
    });

    await this.mobileRepo.recordAudit(
      "admin_verification_rejected",
      reviewerId,
      "admin",
      target.eventId,
      { reviewerName, rejectionReason },
    );

    this.bus.broadcast("emergency:rejected", {
      requestId: target.requestId,
      eventId: target.eventId,
      reviewerName,
      reason: rejectionReason,
      isCorridorAuthorized: false,
    });

    const updated = await this.mobileRepo.getVerificationByRequestId(target.requestId);
    return updated!;
  }
}
