import type { PredictionHorizon } from "@itms/types";

/**
 * Typed HTTP client for the Python prediction service (POST /predict).
 *
 * Responsibilities: request/response typing, timeout handling, and mapping
 * every failure mode (unreachable, timeout, non-JSON, invalid payload,
 * service-side model problems) into a typed result instead of an exception,
 * so the traffic-control loop can apply fallbacks without crashing.
 */

export interface PredictionServiceInput {
  intersectionId: string;
  vehicleCount: number;
  speedMps: number;
  queueLength: number;
  /** Occupancy fraction 0..1. */
  density: number;
  flowRatePerHour: number;
  signalPhase: number;
  /** Raw RYG state string (encoded deterministically inside the service). */
  signalState: string;
  /** Position within the fixed 90 s signal cycle (simulation time % 90). */
  cyclePositionSeconds: number;
  hour: number;
  dayOfWeek: number;
  countLag10s: number | null;
  countLag30s: number | null;
  queueLag10s: number | null;
}

export interface PredictionServiceSuccess {
  ok: true;
  /** Predicted vehicle counts keyed by horizon seconds. */
  predictions: Record<string, number>;
  modelVersion: string;
  inferenceMs: number;
}

export type PredictionServiceFailure =
  | { ok: false; reason: "unavailable" } // service unreachable / network error
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "no_model" } // service up but model not loadable (503)
  | { ok: false; reason: "invalid_input"; message: string } // 400/422
  | { ok: false; reason: "invalid_response"; message: string }; // malformed body

export type PredictionServiceResult = PredictionServiceSuccess | PredictionServiceFailure;

export interface PredictionClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

const HORIZON_KEYS = ["30s", "60s", "90s", "120s"] as const;

export class PredictionClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: PredictionClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
  }

  async predict(input: PredictionServiceInput): Promise<PredictionServiceResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intersection_id: input.intersectionId,
          vehicle_count: input.vehicleCount,
          speed: input.speedMps,
          queue_length: input.queueLength,
          density: input.density,
          flow_rate: input.flowRatePerHour,
          signal_phase: input.signalPhase,
          signal_state: input.signalState,
          cycle_position_s: input.cyclePositionSeconds,
          hour: input.hour,
          day_of_week: input.dayOfWeek,
          count_lag_10s: input.countLag10s,
          count_lag_30s: input.countLag30s,
          queue_lag_10s: input.queueLag10s,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "unavailable" };
    }

    if (response.status === 503) {
      return { ok: false, reason: "no_model" };
    }
    if (response.status === 400 || response.status === 422) {
      let message = `Service rejected the input (HTTP ${response.status}).`;
      try {
        const body = (await response.json()) as { detail?: unknown };
        if (body && typeof body.detail === "string") {
          message = body.detail;
        }
      } catch {
        // keep default message
      }
      return { ok: false, reason: "invalid_input", message };
    }
    if (!response.ok) {
      return { ok: false, reason: "invalid_response", message: `HTTP ${response.status}` };
    }

    try {
      const body = (await response.json()) as {
        predictions?: Record<string, unknown>;
        model_version?: unknown;
        inference_ms?: unknown;
      };
      const predictions = body.predictions;
      if (typeof predictions !== "object" || predictions === null) {
        return { ok: false, reason: "invalid_response", message: "Missing predictions object" };
      }
      const parsed: Record<string, number> = {};
      for (const key of HORIZON_KEYS) {
        const value = predictions[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          return { ok: false, reason: "invalid_response", message: `Horizon "${key}" missing or invalid` };
        }
        parsed[key] = value;
      }
      return {
        ok: true,
        predictions: parsed,
        modelVersion: typeof body.model_version === "string" ? body.model_version : "unknown",
        inferenceMs: typeof body.inference_ms === "number" ? body.inference_ms : 0,
      };
    } catch (err) {
      return {
        ok: false,
        reason: "invalid_response",
        message: err instanceof Error ? err.message : "Malformed JSON",
      };
    }
  }

  /** Checks service/model availability (GET /health). */
  async health(): Promise<{ ok: boolean; status: string | null }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return { ok: false, status: `HTTP ${response.status}` };
      const body = (await response.json()) as { status?: unknown };
      return { ok: body.status === "ready", status: typeof body.status === "string" ? body.status : null };
    } catch {
      return { ok: false, status: null };
    }
  }
}

/** Shared response shaping used by the prediction service and tests. */
export function horizonResultToType(
  predictions: Record<string, number>,
): PredictionHorizon[] {
  return HORIZON_KEYS.map((key, index) => ({
    horizonSeconds: [30, 60, 90, 120][index]!,
    predictedVehicleCount: predictions[key] ?? 0,
  }));
}
