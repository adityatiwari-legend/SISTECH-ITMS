import type {
  ApiErrorBody,
  CorridorDetail,
  CreateCorridorBody,
  CreateEmergencyBody,
  CreateComparisonBody,
  ComparisonResult,
  EmergencyEventDetail,
  NetworkGeometryResponse,
  PredictionsResponse,
  SimulationStatusSnapshot,
  SignalSnapshot,
  SystemOverview,
  AnalyticsResponse,
  DecisionEvent,
  TrafficStateResponse,
  RoadInfo,
  IntersectionInfo,
  VehicleSnapshot,
} from "@itms/types";

/**
 * Typed REST client for the ITMS backend. Every failure becomes a typed
 * result so the UI can render real error states (no fake data).
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";
}

export function wsUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";
  return base.replace(/^http/, "ws") + "/ws";
}

/** Simple backend liveness probe (GET /health). */
export async function checkBackendHealth(): Promise<{ ok: boolean; service: string | null }> {
  try {
    const response = await fetch(baseUrl() + "/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { ok: false, service: null };
    const body = (await response.json()) as { status?: string; service?: string };
    return { ok: body.status === "ok", service: body.service ?? null };
  } catch {
    return { ok: false, service: null };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(baseUrl() + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new ApiError(0, "backend_unreachable", err instanceof Error ? err.message : "Backend is unreachable.");
  }
  if (!response.ok) {
    let code = "http_error";
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // non-JSON error body
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export const api = {
  // simulation
  getSimulationState: () => request<SimulationStatusSnapshot>("/api/simulation/state"),
  startSimulation: (scenario?: string) =>
    request<SimulationStatusSnapshot>("/api/simulation/start", { method: "POST", body: JSON.stringify(scenario ? { scenario } : {}) }),
  stopSimulation: () => request<SimulationStatusSnapshot>("/api/simulation/stop", { method: "POST", body: JSON.stringify({}) }),
  pauseSimulation: () => request<SimulationStatusSnapshot>("/api/simulation/pause", { method: "POST", body: JSON.stringify({}) }),
  resumeSimulation: () => request<SimulationStatusSnapshot>("/api/simulation/resume", { method: "POST", body: JSON.stringify({}) }),
  resetSimulation: (scenario?: string) =>
    request<SimulationStatusSnapshot>("/api/simulation/reset", { method: "POST", body: JSON.stringify(scenario ? { scenario } : {}) }),
  setSimulationSpeed: (multiplier: number) =>
    request<SimulationStatusSnapshot>("/api/simulation/speed", { method: "POST", body: JSON.stringify({ multiplier }) }),

  // traffic
  getTraffic: () => request<TrafficStateResponse>("/api/traffic"),
  getRoads: () => request<{ roads: RoadInfo[] }>("/api/traffic/roads"),
  getIntersections: () => request<{ intersections: IntersectionInfo[] }>("/api/traffic/intersections"),
  getNetworkGeometry: () => request<NetworkGeometryResponse>("/api/network/geometry"),

  // signals
  getSignals: () => request<{ signals: SignalSnapshot[] }>("/api/signals"),
  setSignalState: (id: string, state: string) =>
    request<SignalSnapshot>(`/api/signals/${id}/state`, { method: "POST", body: JSON.stringify({ state }) }),

  // vehicles
  getVehicles: () => request<{ vehicles: VehicleSnapshot[] }>("/api/vehicles"),

  // emergencies
  createEmergency: (body: CreateEmergencyBody) => request<EmergencyEventDetail>("/api/emergency", { method: "POST", body: JSON.stringify(body) }),
  getEmergencies: () => request<{ emergencies: EmergencyEventDetail[] }>("/api/emergency"),
  getEmergency: (id: number) => request<EmergencyEventDetail>(`/api/emergency/${id}`),

  // corridors
  createCorridor: (body: CreateCorridorBody) => request<CorridorDetail>("/api/corridors", { method: "POST", body: JSON.stringify(body) }),
  getCorridors: () => request<{ corridors: CorridorDetail[] }>("/api/corridors"),
  getCorridor: (id: number) => request<CorridorDetail>(`/api/corridors/${id}`),
  activateCorridor: (id: number) => request<CorridorDetail>(`/api/corridors/${id}/activate`, { method: "POST", body: JSON.stringify({}) }),
  cancelCorridor: (id: number, reason?: string) =>
    request<CorridorDetail>(`/api/corridors/${id}/cancel`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) }),

  // predictions
  getPredictions: () => request<PredictionsResponse>("/api/predictions"),

  // scenarios / comparison
  startComparison: (body: CreateComparisonBody) => request<ComparisonResult>("/api/scenarios/compare", { method: "POST", body: JSON.stringify(body) }),
  getComparison: (jobId: string) => request<ComparisonResult>(`/api/scenarios/compare/${jobId}`),
  getComparisonRuns: () => request<{ runs: unknown[] }>("/api/scenarios/runs"),

  // system
  getAnalytics: () => request<AnalyticsResponse>("/api/analytics"),
  getDecisions: () => request<{ events: DecisionEvent[] }>("/api/decisions"),
  getSystem: () => request<SystemOverview>("/api/system"),

  // AI Copilot (Vultr Serverless Inference)
  askAiCopilot: (question: string, context?: { intersectionId?: string; emergencyId?: number; decisionId?: string; focus?: string }) =>
    request<{ answer: string; citations: string[]; source: string; model: string; timestamp: string }>("/api/ai/copilot", {
      method: "POST",
      body: JSON.stringify({ question, context }),
    }),
};
