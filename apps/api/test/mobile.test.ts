import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/modules/auth/auth-service.ts";
import { AiVerificationService } from "../src/modules/ai/verification-service.ts";
import { MobileService } from "../src/modules/mobile/mobile-service.ts";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { RoadGraph } from "../src/modules/routing/road-graph.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { geoFromCatalog } from "../src/modules/simulation/geo.ts";
import { createLogger } from "../src/logger.ts";
import { NETWORK_PATH } from "./helpers.ts";

test("mobile auth: password hashing, verification, jwt creation & verify", async () => {
  const auth = new AuthService({} as any, "itms-mobile-secret-jwt-key-for-test-32chars");
  const password = "securePassword123";
  const hashed = auth.hashPassword(password);

  assert.ok(hashed.startsWith("scrypt:"), "hash must use scrypt format");
  assert.equal(auth.verifyPassword(password, hashed), true);
  assert.equal(auth.verifyPassword("wrongPassword", hashed), false);

  const token = auth.createToken({
    sub: 101,
    code: "DRV-802",
    email: "driver@sistec.demo",
    role: "driver",
  });

  const payload = auth.verifyToken(token);
  assert.equal(payload.sub, 101);
  assert.equal(payload.code, "DRV-802");
  assert.equal(payload.role, "driver");
  assert.equal(payload.email, "driver@sistec.demo");
});

test("mobile geo & routing: gps translation and A* route preview", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);
  const geo = geoFromCatalog(catalog);
  const logger = createLogger("mobile-test", "error");

  const mobileService = new MobileService({
    mobileRepo: {} as any,
    emergencyRepo: {} as any,
    catalog,
    routeEngine,
    corridorService: {} as any,
    bus: {} as any,
    emergencyService: {} as any,
    aiVerificationService: {} as any,
  });

  // Test GPS to network junction mapping
  const mapped = mobileService.translateGpsToNetwork(23.2599, 77.4126);
  assert.ok(mapped.junctionId.length > 0, `mapped junction should be network node: ${mapped.junctionId}`);

  // Test Route Preview
  const preview = await mobileService.previewRoute({
    originJunction: "I1",
    destinationJunction: "I6",
  });

  assert.equal(preview.originJunction, "I1");
  assert.equal(preview.destinationJunction, "I6");
  assert.ok(preview.totalLengthM > 0, "preview total length must be > 0");
  assert.ok(preview.segments.length > 0, "preview must contain route segments");
});

test("mobile AI verification: deterministic state machine and corridor authorization gating", async () => {
  const logger = createLogger("vrf-test", "error");
  let lastSavedStatus = "";
  let lastAuthFlag = false;

  const mockMobileRepo: any = {
    createOrUpdateVerification: async (data: any) => {
      lastSavedStatus = data.status;
      lastAuthFlag = data.isCorridorAuthorized;
    },
    recordAiResult: async () => {},
    getVerificationByEventId: async () => null,
    getVerificationByRequestId: async (reqId: string) => ({
      id: 1,
      requestId: reqId,
      eventId: 10,
      status: lastSavedStatus,
      isCorridorAuthorized: lastAuthFlag,
    }),
    updateVerificationStatus: async (id: number, status: string, isAuth: boolean) => {
      lastSavedStatus = status;
      lastAuthFlag = isAuth;
    },
    listVerifications: async () => [
      {
        id: 1,
        requestId: "VRF-TEST-001",
        eventId: 10,
        status: lastSavedStatus,
        isCorridorAuthorized: lastAuthFlag,
      },
      {
        id: 2,
        requestId: "VRF-TEST-002",
        eventId: 11,
        status: lastSavedStatus,
        isCorridorAuthorized: lastAuthFlag,
      },
    ],
    adminApproveTransaction: async () => {
      lastSavedStatus = "adminApproved";
      lastAuthFlag = true;
    },
    adminRejectTransaction: async () => {
      lastSavedStatus = "adminRejected";
      lastAuthFlag = false;
    },
    recordAudit: async () => {},
  };

  const mockBus: any = {
    emitToDriver: () => {},
    emit: () => {},
    broadcast: () => {},
  };

  const vrfService = new AiVerificationService({
    config: { vultrApiKey: null } as any,
    logger,
    mobileRepo: mockMobileRepo,
    bus: mockBus,
  });

  // Captured photos are flagged for manual review and webapp approval
  const resultA = await vrfService.processVerification({
    requestId: "VRF-TEST-001",
    eventId: 10,
    capturedPhotoPath: "dummy.jpg",
    scenario: "scenarioA",
  });

  assert.equal(resultA.status, "manualReview");
  assert.equal(resultA.isCorridorAuthorized, false);
  assert.equal(lastAuthFlag, false);

  // Admin approves via webapp -> status becomes adminApproved and corridor is authorized
  const approvedA = await vrfService.adminApprove(
    resultA.id,
    "ADM-001",
    "Admin Operator",
    "Verified and approved by Control Center.",
  );
  assert.equal(approvedA.status, "adminApproved");
  assert.equal(approvedA.isCorridorAuthorized, true);
  assert.equal(lastAuthFlag, true);

  // Another captured photo -> also flagged for review
  const resultB = await vrfService.processVerification({
    requestId: "VRF-TEST-002",
    eventId: 11,
    capturedPhotoPath: "dummy.jpg",
    scenario: "scenarioB",
  });

  assert.equal(resultB.status, "manualReview");
  assert.equal(resultB.isCorridorAuthorized, false);

  // Admin rejects -> status becomes adminRejected and corridor remains unauthorized
  const rejectedB = await vrfService.adminReject(
    resultB.id,
    "ADM-001",
    "Admin Operator",
    "Rejected by supervisor.",
  );
  assert.equal(rejectedB.status, "adminRejected");
  assert.equal(rejectedB.isCorridorAuthorized, false);
});

