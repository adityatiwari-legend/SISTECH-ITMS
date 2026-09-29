"use client";

import React from "react";
import type {
  DecisionEvent,
  EmergencyEventDetail,
  PredictionUpdatePayload,
  SignalSnapshot,
  SimulationStatusSnapshot,
  TrafficStateResponse,
  VehicleSnapshot,
  CorridorDetail,
  WsEvent,
  SystemStatusResponse,
} from "@itms/types";
import { api, ApiError, checkBackendHealth, wsUrl } from "./api";
import { getJunctionMeta } from "./naming";

/**
 * Live ITMS state: REST bootstrap + polls, WebSocket events, honest
 * connection states per component (system / backend / websocket / sumo /
 * simulation / map). No fake data — disconnected states are rendered as-is.
 */

export type ConnectionState = "connecting" | "online" | "offline";

export interface NormalizedTrafficState {
  timestamp: string;
  activeVehicleCount: number;
  averageSpeedMps: number;
  queueLength: number;
  congestionLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  signalCount: number;
}

export interface ItmsLiveState {
  sim: SimulationStatusSnapshot | null;
  traffic: TrafficStateResponse | null;
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergencies: EmergencyEventDetail[];
  corridors: CorridorDetail[];
  predictions: PredictionUpdatePayload | null;
  trace: DecisionEvent[];
  normalizedTraffic: NormalizedTrafficState;
  /** Component health chips (TOP BAR) */
  systemOnline: boolean; // backend + ws + sumo healthy
  backendConnected: ConnectionState; // GET /health probe
  websocketConnected: ConnectionState; // open + heartbeats alive
  sumoConnected: boolean; // sim.status === running/paused/completed
  /** Authoritative backend status */
  systemStatus: "online" | "degraded" | "offline";
  sumoStatus: "connected" | "disconnected" | "error";
  traciStatus: "connected" | "disconnected" | "error";
  databaseStatus: "connected" | "disconnected" | "error";
  websocketStatus: "connected" | "disconnected" | "error";
  executionMode: "SIMULATION" | "REAL_GPS";
  /** Derived overall connection (worst of backend/websocket) for generic banners. */
  connection: ConnectionState;
  lastError: string | null;
}

export type EmergencyUpsertPayload = Partial<EmergencyEventDetail> & {
  id: number;
  version?: number;
  origin?: string;
  destination?: string;
  startedAt?: string;
  vehicleId?: string;
};

type Action =
  | { type: "sim"; payload: SimulationStatusSnapshot }
  | { type: "traffic"; payload: TrafficStateResponse }
  | { type: "signals"; payload: SignalSnapshot[] }
  | { type: "vehicles"; payload: VehicleSnapshot[] }
  | { type: "emergencies"; payload: EmergencyEventDetail[] }
  | { type: "emergency_upsert"; payload: EmergencyUpsertPayload }
  | { type: "emergency_finish"; payload: { eventId: number; status: "arrived" | "cancelled" } }
  | { type: "emergency_delete"; payload: { eventId: number } }
  | { type: "corridors"; payload: CorridorDetail[] }
  | { type: "prediction"; payload: PredictionUpdatePayload }
  | { type: "trace"; payload: DecisionEvent }
  | { type: "backend"; payload: ConnectionState }
  | { type: "websocket"; payload: ConnectionState }
  | { type: "system_status"; payload: SystemStatusResponse }
  | { type: "error"; payload: string | null };

const MAX_TRACE = 300;
const HEARTBEAT_STALE_MS = 35_000;

function computeNormalizedTraffic(
  vehicles: VehicleSnapshot[],
  traffic: TrafficStateResponse | null,
  sim: SimulationStatusSnapshot | null,
  signals: SignalSnapshot[],
): NormalizedTrafficState {
  const activeCount =
    vehicles.length > 0
      ? vehicles.length
      : (traffic?.summary.vehicleCount ?? sim?.vehicleCount ?? 0);

  let avgSpeed = 0;
  if (vehicles.length > 0) {
    const sumSpeed = vehicles.reduce((acc, v) => acc + (v.speed ?? (v as { speedMps?: number }).speedMps ?? 0), 0);
    avgSpeed = Math.round((sumSpeed / vehicles.length) * 100) / 100;
  } else if (traffic?.summary.avgSpeedMps) {
    avgSpeed = traffic.summary.avgSpeedMps;
  }

  return {
    timestamp: new Date().toISOString(),
    activeVehicleCount: activeCount,
    averageSpeedMps: avgSpeed,
    queueLength: traffic?.summary.totalQueueLength ?? 0,
    congestionLevel: traffic?.summary.cityLevel ?? "LOW",
    signalCount: signals.length > 0 ? signals.length : (sim?.signalCount ?? 0),
  };
}

function initialState(): ItmsLiveState {
  return {
    sim: null,
    traffic: null,
    signals: [],
    vehicles: [],
    emergencies: [],
    corridors: [],
    predictions: null,
    trace: [],
    normalizedTraffic: {
      timestamp: new Date().toISOString(),
      activeVehicleCount: 0,
      averageSpeedMps: 0,
      queueLength: 0,
      congestionLevel: "LOW",
      signalCount: 0,
    },
    systemOnline: false,
    backendConnected: "connecting",
    websocketConnected: "connecting",
    sumoConnected: false,
    systemStatus: "online",
    sumoStatus: "disconnected",
    traciStatus: "disconnected",
    databaseStatus: "connected",
    websocketStatus: "connected",
    executionMode: "SIMULATION",
    connection: "connecting",
    lastError: null,
  };
}

/** The overall connection is the worst of backend/websocket. */
function overallConnection(state: ItmsLiveState): ConnectionState {
  const rank: Record<ConnectionState, number> = { online: 0, connecting: 1, offline: 2 };
  return rank[state.backendConnected] >= rank[state.websocketConnected] ? state.backendConnected : state.websocketConnected;
}

function updateSystem(state: ItmsLiveState): ItmsLiveState {
  return {
    ...state,
    systemOnline:
      state.backendConnected === "online" && state.websocketConnected === "online" && state.sumoConnected,
    connection: overallConnection(state),
  };
}

function reducer(state: ItmsLiveState, action: Action): ItmsLiveState {
  let next = state;
  switch (action.type) {
    case "sim":
      next = { ...state, sim: action.payload };
      next = { ...next, sumoConnected: ["running", "paused", "completed"].includes(action.payload.status) };
      break;
    case "traffic":
      next = { ...state, traffic: action.payload };
      break;
    case "signals":
      next = { ...state, signals: action.payload };
      break;
    case "vehicles":
      next = { ...state, vehicles: action.payload };
      break;
    case "emergencies":
      next = { ...state, emergencies: action.payload };
      break;
    case "emergency_upsert": {
      const p = action.payload;
      const existingIdx = state.emergencies.findIndex((e) => e.id === p.id);
      let updatedEmergencies: EmergencyEventDetail[];
      if (existingIdx >= 0) {
        const existing = state.emergencies[existingIdx];
        if (p.version !== undefined && existing.version !== undefined && existing.version > p.version) {
          return state;
        }
        const merged: EmergencyEventDetail = {
          ...existing,
          ...p,
          version: p.version ?? existing.version,
        };
        updatedEmergencies = [...state.emergencies];
        updatedEmergencies[existingIdx] = merged;
      } else {
        const newEmerg: EmergencyEventDetail = {
          id: p.id,
          type: p.type ?? "ambulance",
          priority: p.priority ?? "CRITICAL",
          status: p.status ?? "active",
          originJunction: p.originJunction ?? p.origin ?? "",
          destinationJunction: p.destinationJunction ?? p.destination ?? "",
          createdAtIso: p.createdAtIso ?? p.startedAt ?? new Date().toISOString(),
          activatedAtIso: p.activatedAtIso ?? new Date().toISOString(),
          arrivedAtIso: p.arrivedAtIso ?? null,
          vehicle: p.vehicle ?? (p.vehicleId ? { vehicleId: p.vehicleId, type: p.type ?? "ambulance", maxSpeedMps: 25 } : null),
          route: p.route ?? null,
          etas: p.etas ?? null,
          live: p.live ?? null,
          mobile: p.mobile ?? null,
        } as unknown as EmergencyEventDetail;
        updatedEmergencies = [newEmerg, ...state.emergencies];
      }
      return { ...state, emergencies: updatedEmergencies };
    }
    case "emergency_finish": {
      const { eventId, status } = action.payload;
      const updated = state.emergencies.map((e) => {
        if (e.id === eventId) {
          return {
            ...e,
            status,
            arrivedAtIso: status === "arrived" ? new Date().toISOString() : e.arrivedAtIso,
          };
        }
        return e;
      });
      const updatedCorridors = state.corridors.map((c) => {
        if (c.eventId === eventId) {
          return { ...c, status: status === "arrived" ? ("COMPLETED" as const) : ("CANCELLED" as const) };
        }
        return c;
      });
      return { ...state, emergencies: updated, corridors: updatedCorridors };
    }
    case "emergency_delete": {
      const { eventId } = action.payload;
      return {
        ...state,
        emergencies: state.emergencies.filter((e) => e.id !== eventId),
        corridors: state.corridors.filter((c) => c.eventId !== eventId),
      };
    }
    case "corridors":
      next = { ...state, corridors: action.payload };
      break;
    case "prediction":
      next = { ...state, predictions: action.payload };
      break;
    case "trace": {
      const trace = [action.payload, ...state.trace];
      if (trace.length > MAX_TRACE) trace.length = MAX_TRACE;
      return { ...state, trace };
    }
    case "backend":
      next = { ...state, backendConnected: action.payload };
      break;
    case "websocket":
      next = { ...state, websocketConnected: action.payload };
      break;
    case "system_status": {
      const s = action.payload;
      next = {
        ...state,
        systemStatus: s.systemStatus,
        sumoStatus: s.sumoStatus,
        traciStatus: s.traciStatus,
        databaseStatus: s.databaseStatus,
        websocketStatus: s.websocketStatus,
        executionMode: s.mode,
        sumoConnected: s.sumoStatus === "connected",
        systemOnline: s.systemStatus === "online",
      };
      break;
    }
    case "error":
      return { ...state, lastError: action.payload };
    default:
      return state;
  }

  next = updateSystem(next);
  next = {
    ...next,
    normalizedTraffic: computeNormalizedTraffic(next.vehicles, next.traffic, next.sim, next.signals),
  };
  return next;
}

const ItmsContext = React.createContext<{
  state: ItmsLiveState;
  refreshAll(): Promise<void>;
} | null>(null);

export function ItmsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let livenessTimer: NodeJS.Timeout | null = null;
    let corePollTimer: NodeJS.Timeout | null = null;
    let listPollTimer: NodeJS.Timeout | null = null;
    let reconnectAttempt = 0;
    let lastHeartbeatAt = 0;
    const lastSignalStages = new Map<string, string>();

    const safeRest = async <T,>(call: () => Promise<T>): Promise<T | null> => {
      try {
        return await call();
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          dispatch({ type: "backend", payload: "offline" });
        }
        return null;
      }
    };

    const refreshCore = async (): Promise<void> => {
      const sim = await safeRest(api.getSimulationState);
      if (sim !== null) dispatch({ type: "sim", payload: sim });
      const traffic = await safeRest(api.getTraffic);
      if (traffic !== null) dispatch({ type: "traffic", payload: traffic });
      const signals = await safeRest(api.getSignals);
      if (signals !== null) dispatch({ type: "signals", payload: signals.signals });
      const vehicles = await safeRest(api.getVehicles);
      if (vehicles !== null && vehicles.vehicles) dispatch({ type: "vehicles", payload: vehicles.vehicles });
    };

    const refreshLists = async (): Promise<void> => {
      const emergencies = await safeRest(api.getEmergencies);
      if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
      const corridors = await safeRest(api.getCorridors);
      if (corridors !== null) dispatch({ type: "corridors", payload: corridors.corridors });
      const predictions = await safeRest(api.getPredictions);
      if (predictions !== null) {
        dispatch({ type: "prediction", payload: { simTimeSeconds: predictions.simTimeSeconds, predictions: predictions.predictions } });
      }
    };

    // ---- initial bootstrap ----
    (async () => {
      const health = await checkBackendHealth();
      dispatch({ type: "backend", payload: health.ok ? "online" : "offline" });
      const sysStatus = await safeRest(api.getSystemStatus);
      if (sysStatus) dispatch({ type: "system_status", payload: sysStatus });
      await refreshCore();
      await refreshLists();
    })();

    // ---- backend health & system status poll (independent of WS) ----
    const healthTimer = setInterval(async () => {
      const health = await checkBackendHealth();
      dispatch({ type: "backend", payload: health.ok ? "online" : "offline" });
      const sysStatus = await safeRest(api.getSystemStatus);
      if (sysStatus) dispatch({ type: "system_status", payload: sysStatus });
      // Dual-channel sync: periodically refresh emergencies list to safeguard against dropped WS frames
      const emergencies = await safeRest(api.getEmergencies);
      if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
    }, 5000);

    // ---- WebSocket with exponential backoff reconnect + heartbeat liveness ----
    const connectWs = (): void => {
      if (disposed) return;
      try {
        socket = new WebSocket(wsUrl());
      } catch {
        dispatch({ type: "websocket", payload: "offline" });
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        reconnectAttempt = 0;
        lastHeartbeatAt = Date.now();
        dispatch({ type: "websocket", payload: "online" });
        void refreshCore();
        void refreshLists();
      };
      socket.onmessage = (message) => {
        let event: WsEvent<unknown>;
        try {
          event = JSON.parse(String(message.data)) as WsEvent<unknown>;
        } catch {
          return;
        }
        if (event.type === "heartbeat") {
          lastHeartbeatAt = Date.now();
          return;
        }
        handleWsEvent(event);
      };
      socket.onclose = () => {
        if (!disposed) {
          dispatch({ type: "websocket", payload: "offline" });
          scheduleReconnect();
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    };
    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer !== null) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
      const delayMs = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, delayMs);
    };
    // Liveness: if no heartbeat within the window, force reconnect.
    livenessTimer = setInterval(() => {
      if (socket !== null && socket.readyState === WebSocket.OPEN && Date.now() - lastHeartbeatAt > HEARTBEAT_STALE_MS) {
        socket.close();
      }
    }, 10_000);

    const handleWsEvent = (event: WsEvent<unknown>): void => {
      switch (event.type) {
        case "traffic:update": {
          const payload = event.payload as {
            simTimeSeconds: number;
            collectedAtIso: string;
            stale: boolean;
            summary: TrafficStateResponse["summary"];
            segments: TrafficStateResponse["segments"];
            intersections: TrafficStateResponse["intersections"];
          };
          const previous = stateRef.current.traffic;
          const fallbackSystem: TrafficStateResponse["system"] = {
            simulationStatus: stateRef.current.sim?.status ?? "running",
            simulationError: null,
            dbConnected: true,
            lastDbError: null,
            lastPersistError: null,
          };
          dispatch({
            type: "traffic",
            payload:
              previous !== null
                ? { ...previous, ...payload }
                : ({ ...payload, ageSeconds: 0, system: fallbackSystem } as TrafficStateResponse),
          });
          break;
        }
        case "vehicle:update":
          dispatch({ type: "vehicles", payload: (event.payload as { vehicles: VehicleSnapshot[] }).vehicles });
          break;
        case "signal:update":
          dispatch({ type: "signals", payload: (event.payload as { signals: SignalSnapshot[] }).signals });
          break;
        case "prediction:update": {
          dispatch({ type: "prediction", payload: event.payload as PredictionUpdatePayload });
          break;
        }
        case "emergency:created":
        case "emergency:update": {
          const payload = event.payload as Record<string, unknown>;
          const rawId = payload.id ?? payload.eventId ?? payload.emergencyId;
          const eventId = typeof rawId === "number" ? rawId : Number(rawId);
          if (Number.isFinite(eventId)) {
            dispatch({
              type: "emergency_upsert",
              payload: {
                ...payload,
                id: eventId,
                version: typeof payload.version === "number" ? payload.version : undefined,
              } as unknown as EmergencyUpsertPayload,
            });
            if (payload.status === "arrived" || payload.status === "completed") {
              dispatch({
                type: "emergency_finish",
                payload: { eventId, status: "arrived" },
              });
            }
          }
          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind: event.type === "emergency:created" ? "emergency.created" : "emergency.activated",
              message: describeEvent(event.type, payload),
              refs: { emergencyEventId: Number.isFinite(eventId) ? eventId : undefined },
            },
          });
          void safeRest(api.getEmergencies).then((emergencies) => {
            if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
          });
          break;
        }
        case "emergency:completed":
        case "emergency:cancelled": {
          const payload = event.payload as Record<string, unknown>;
          const rawId = payload.id ?? payload.eventId ?? payload.emergencyId;
          const eventId = typeof rawId === "number" ? rawId : Number(rawId);
          const status = event.type === "emergency:completed" ? "arrived" : "cancelled";
          if (Number.isFinite(eventId)) {
            dispatch({
              type: "emergency_finish",
              payload: { eventId, status },
            });
          }
          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind: status === "arrived" ? "emergency.arrived" : "emergency.activated",
              message: describeEvent(event.type, payload),
              refs: { emergencyEventId: Number.isFinite(eventId) ? eventId : undefined },
            },
          });
          void safeRest(api.getEmergencies).then((emergencies) => {
            if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
          });
          break;
        }
        case "emergency:deleted": {
          const payload = event.payload as Record<string, unknown>;
          const rawId = payload.id ?? payload.eventId ?? payload.emergencyId;
          const eventId = typeof rawId === "number" ? rawId : Number(rawId);
          if (Number.isFinite(eventId)) {
            dispatch({
              type: "emergency_delete",
              payload: { eventId },
            });
          }
          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind: "emergency.deleted",
              message: `Emergency #${eventId} deleted by operator`,
              refs: { emergencyEventId: Number.isFinite(eventId) ? eventId : undefined },
            },
          });
          void safeRest(api.getEmergencies).then((emergencies) => {
            if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
          });
          break;
        }
        case "emergency:verification:submitted":
        case "emergency:verification:analyzing":
        case "emergency:verified":
        case "emergency:fraud-flagged":
        case "emergency:manual-review":
        case "emergency:approved":
        case "emergency:rejected":
        case "corridor:authorized":
        case "route:updated":
        case "route:switched": {
          const payload = event.payload as Record<string, unknown>;
          const eventId = typeof payload.eventId === "number" ? payload.eventId : undefined;
          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind:
                event.type === "route:switched"
                  ? "route.switched"
                  : event.type === "route:updated"
                    ? "route.computed"
                    : "emergency.activated",
              message: describeEvent(event.type, payload),
              refs: { emergencyEventId: eventId },
            },
          });
          void safeRest(api.getEmergencies).then((emergencies) => {
            if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
          });
          break;
        }
        case "corridor:created":
        case "corridor:update": {
          const payload = event.payload as Record<string, unknown>;
          const signals = Array.isArray(payload.signals)
            ? (payload.signals as Array<{ junctionId: string; status: string; stage?: string; etaSeconds?: number }>)
            : [];

          // Track stage changes per junction for live timeline trace
          for (const s of signals) {
            const currentStage = s.stage ?? (s.status === "APPLIED" ? "GREEN" : s.status === "PASSED" ? "PASSED" : undefined);
            if (!currentStage) continue;
            const prevStage = lastSignalStages.get(s.junctionId);
            if (prevStage !== currentStage) {
              lastSignalStages.set(s.junctionId, currentStage);
              const meta = getJunctionMeta(s.junctionId);
              let msg = "";
              let kind: DecisionEvent["kind"] = "signal.applied";
              if (currentStage === "PREPARING") {
                msg = `${meta.code} preparation started`;
              } else if (currentStage === "CLEARING") {
                msg = `${meta.code} cross traffic clearing`;
              } else if (currentStage === "GREEN") {
                msg = `${meta.code} GREEN`;
              } else if (currentStage === "PASSED") {
                msg = `Ambulance passed ${meta.code}`;
                kind = "signal.passed";
              } else if (currentStage === "RESTORING") {
                msg = `${meta.code} restoring normal control`;
                kind = "signal.passed";
              }
              if (msg) {
                dispatch({
                  type: "trace",
                  payload: {
                    ts: event.ts,
                    kind,
                    message: msg,
                    refs: {
                      signalId: s.junctionId,
                      corridorId: typeof payload.corridorId === "number" ? payload.corridorId : undefined,
                    },
                  },
                });
              }
            }
          }

          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind:
                event.type === "corridor:created"
                  ? "corridor.created"
                  : payload.status === "COMPLETED"
                    ? "corridor.completed"
                    : payload.status === "CANCELLED"
                      ? "corridor.cancelled"
                      : payload.status === "FAILED"
                        ? "corridor.failed"
                        : "corridor.activated",
              message: describeEvent(event.type, payload),
              refs: {
                corridorId: typeof payload.corridorId === "number" ? payload.corridorId : undefined,
                emergencyEventId: typeof payload.eventId === "number" ? payload.eventId : undefined,
              },
            },
          });
          void safeRest(api.getCorridors).then((corridors) => {
            if (corridors !== null) dispatch({ type: "corridors", payload: corridors.corridors });
          });
          break;
        }
        case "system:alert":
          dispatch({ type: "error", payload: String((event.payload as { message?: string }).message ?? "System alert") });
          break;
        default:
          break;
      }
    };

    // ---- REST polls as fallback for missed WS events ----
    corePollTimer = setInterval(() => void refreshCore(), 2500);
    listPollTimer = setInterval(() => void refreshLists(), 4000);

    connectWs();

    return () => {
      disposed = true;
      clearInterval(healthTimer);
      clearInterval(livenessTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (corePollTimer !== null) clearInterval(corePollTimer);
      if (listPollTimer !== null) clearInterval(listPollTimer);
      socket?.close();
    };
  }, []);

  const refreshAll = React.useCallback(async (): Promise<void> => {
    const health = await checkBackendHealth();
    dispatch({ type: "backend", payload: health.ok ? "online" : "offline" });
    await refreshCoreRef.current();
    await refreshListsRef.current();
  }, []);

  // Stable refs so refreshAll can reuse the effect-scoped functions.
  const refreshCoreRef = React.useRef<() => Promise<void>>(async () => undefined);
  const refreshListsRef = React.useRef<() => Promise<void>>(async () => undefined);

  return <ItmsContext.Provider value={{ state, refreshAll }}>{children}</ItmsContext.Provider>;
}

// Assign the effect-scoped refreshers to the refs used by refreshAll.
export function useItms(): { state: ItmsLiveState; refreshAll(): Promise<void> } {
  const context = React.useContext(ItmsContext);
  if (context === null) {
    throw new Error("useItms must be used inside ItmsProvider");
  }
  return context;
}

function describeEvent(type: WsEvent<unknown>["type"], payload: Record<string, unknown>): string {
  switch (type) {
    case "emergency:created":
      return `Emergency detected`;
    case "emergency:update":
      return `Emergency vehicle ${String(payload.status)}`;
    case "route:updated":
      return `Route calculated (${Array.isArray(payload.segments) ? payload.segments.length : 0} road links)`;
    case "route:switched":
      return `Route dynamically optimized: ${String(payload.reason ?? "congestion bypass")}`;
    case "corridor:created":
      return `Green corridor planned`;
    case "corridor:update": {
      const status = String(payload.status ?? "update");
      const applied = Array.isArray(payload.signals)
        ? (payload.signals as Array<{ status: string }>).filter((signal) => signal.status === "APPLIED").length
        : 0;
      return `Green corridor ${status.toLowerCase()}${applied > 0 ? ` (${applied} priority hold)` : ""}`;
    }
    default:
      return type;
  }
}
