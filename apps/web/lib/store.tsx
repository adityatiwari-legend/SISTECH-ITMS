"use client";

import React from "react";
import type {
  ComparisonResult,
  CorridorDetail,
  DecisionEvent,
  EmergencyEventDetail,
  PredictionUpdatePayload,
  SignalSnapshot,
  SimulationStatusSnapshot,
  TrafficStateResponse,
  VehicleSnapshot,
  WsEvent,
} from "@itms/types";
import { api, ApiError, wsUrl } from "./api";

/**
 * Live ITMS state: REST bootstrap + polling fallback, WebSocket events for
 * real-time updates, and an accumulated decision trace (real backend events
 * only). All state is honest: connection problems are surfaced, never
 * masked with fabricated data.
 */

export type ConnectionState = "connecting" | "online" | "offline";

export interface ItmsLiveState {
  sim: SimulationStatusSnapshot | null;
  traffic: TrafficStateResponse | null;
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergencies: EmergencyEventDetail[];
  corridors: CorridorDetail[];
  predictions: PredictionUpdatePayload | null;
  trace: DecisionEvent[];
  connection: ConnectionState;
  lastError: string | null;
}

type Action =
  | { type: "sim"; payload: SimulationStatusSnapshot }
  | { type: "traffic"; payload: TrafficStateResponse }
  | { type: "signals"; payload: SignalSnapshot[] }
  | { type: "vehicles"; payload: VehicleSnapshot[] }
  | { type: "emergencies"; payload: EmergencyEventDetail[] }
  | { type: "corridors"; payload: CorridorDetail[] }
  | { type: "prediction"; payload: PredictionUpdatePayload }
  | { type: "trace"; payload: DecisionEvent }
  | { type: "connection"; payload: ConnectionState }
  | { type: "error"; payload: string | null }
  | { type: "reset" };

const MAX_TRACE = 300;

function reducer(state: ItmsLiveState, action: Action): ItmsLiveState {
  switch (action.type) {
    case "sim":
      return { ...state, sim: action.payload };
    case "traffic":
      return { ...state, traffic: action.payload };
    case "signals":
      return { ...state, signals: action.payload };
    case "vehicles":
      return { ...state, vehicles: action.payload };
    case "emergencies":
      return { ...state, emergencies: action.payload };
    case "corridors":
      return { ...state, corridors: action.payload };
    case "prediction":
      return { ...state, predictions: action.payload };
    case "trace": {
      const trace = [action.payload, ...state.trace];
      if (trace.length > MAX_TRACE) trace.length = MAX_TRACE;
      return { ...state, trace };
    }
    case "connection":
      return { ...state, connection: action.payload };
    case "error":
      return { ...state, lastError: action.payload };
    case "reset":
      return { ...initialState, connection: state.connection };
    default:
      return state;
  }
}

const initialState: ItmsLiveState = {
  sim: null,
  traffic: null,
  signals: [],
  vehicles: [],
  emergencies: [],
  corridors: [],
  predictions: null,
  trace: [],
  connection: "connecting",
  lastError: null,
};

const ItmsContext = React.createContext<{
  state: ItmsLiveState;
  refreshAll(): Promise<void>;
} | null>(null);

export function ItmsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const safeRest = React.useCallback(async <T,>(call: () => Promise<T>): Promise<T | null> => {
    try {
      return await call();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        dispatch({ type: "connection", payload: "offline" });
      }
      return null;
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pollTimer: NodeJS.Timeout | null = null;

    const refreshCore = async (): Promise<void> => {
      const sim = await safeRest(api.getSimulationState);
      if (sim !== null) dispatch({ type: "sim", payload: sim });
      const traffic = await safeRest(api.getTraffic);
      if (traffic !== null) dispatch({ type: "traffic", payload: traffic });
      const signals = await safeRest(api.getSignals);
      if (signals !== null) dispatch({ type: "signals", payload: signals.signals });
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

    (async () => {
      await refreshCore();
      await refreshLists();
      if (disposed) return;
      dispatch({ type: "connection", payload: "online" });
    })();

    // WebSocket: real-time events.
    const connectWs = (): void => {
      try {
        socket = new WebSocket(wsUrl());
      } catch {
        dispatch({ type: "connection", payload: "offline" });
        scheduleReconnect();
        return;
      }
      socket.onopen = () => dispatch({ type: "connection", payload: "online" });
      socket.onmessage = (message) => {
        let event: WsEvent<unknown>;
        try {
          event = JSON.parse(String(message.data)) as WsEvent<unknown>;
        } catch {
          return;
        }
        handleWsEvent(event);
      };
      socket.onclose = () => {
        if (!disposed) {
          dispatch({ type: "connection", payload: "offline" });
          scheduleReconnect();
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    };
    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, 2000);
    };

    const handleWsEvent = (event: WsEvent<unknown>): void => {
      switch (event.type) {
        case "traffic:update":
          dispatch({
            type: "traffic",
            payload: {
              ...(stateRef.current.traffic ?? ({} as TrafficStateResponse)),
              simTimeSeconds: (event.payload as { simTimeSeconds: number }).simTimeSeconds,
              collectedAtIso: (event.payload as { collectedAtIso: string }).collectedAtIso,
              stale: (event.payload as { stale: boolean }).stale,
              summary: (event.payload as { summary: TrafficStateResponse["summary"] }).summary,
              segments: (event.payload as { segments: TrafficStateResponse["segments"] }).segments,
              intersections: (event.payload as { intersections: TrafficStateResponse["intersections"] }).intersections,
            } as TrafficStateResponse,
          });
          break;
        case "vehicle:update":
          dispatch({ type: "vehicles", payload: (event.payload as { vehicles: VehicleSnapshot[] }).vehicles });
          break;
        case "signal:update":
          dispatch({ type: "signals", payload: (event.payload as { signals: SignalSnapshot[] }).signals });
          break;
        case "prediction:update": {
          const payload = event.payload as PredictionUpdatePayload;
          dispatch({ type: "prediction", payload });
          break;
        }
        case "emergency:created":
        case "emergency:update":
        case "route:updated":
        case "route:switched": {
          // Decision trace entries from real events.
          const payload = event.payload as Record<string, unknown>;
          const eventId = typeof payload.eventId === "number" ? payload.eventId : undefined;
          dispatch({
            type: "trace",
            payload: {
              ts: event.ts,
              kind: event.type === "emergency:created" ? "emergency.created" : event.type === "route:switched" ? "route.switched" : event.type === "route:updated" ? "route.computed" : "emergency.activated",
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

    // REST polls as a fallback for anything WS might miss (paced).
    pollTimer = setInterval(() => {
      void refreshCore();
    }, 2500);
    const listTimer = setInterval(() => {
      void refreshLists();
    }, 4000);

    connectWs();
    // safeRest is a stable useCallback; the effect intentionally mounts once.

    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pollTimer !== null) clearInterval(pollTimer);
      clearInterval(listTimer);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time connection lifecycle
  }, []);

  const refreshAll = React.useCallback(async (): Promise<void> => {
    const sim = await safeRest(api.getSimulationState);
    if (sim !== null) dispatch({ type: "sim", payload: sim });
    const traffic = await safeRest(api.getTraffic);
    if (traffic !== null) dispatch({ type: "traffic", payload: traffic });
    const signals = await safeRest(api.getSignals);
    if (signals !== null) dispatch({ type: "signals", payload: signals.signals });
    const emergencies = await safeRest(api.getEmergencies);
    if (emergencies !== null) dispatch({ type: "emergencies", payload: emergencies.emergencies });
    const corridors = await safeRest(api.getCorridors);
    if (corridors !== null) dispatch({ type: "corridors", payload: corridors.corridors });
    const predictions = await safeRest(api.getPredictions);
    if (predictions !== null) {
      dispatch({ type: "prediction", payload: { simTimeSeconds: predictions.simTimeSeconds, predictions: predictions.predictions } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- safeRest is a stable useCallback
  }, []);

  return <ItmsContext.Provider value={{ state, refreshAll }}>{children}</ItmsContext.Provider>;
}

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
      return `Emergency event ${String(payload.eventId)} created (${String(payload.type)}, ${String(payload.priority)}, ${String(payload.origin)} → ${String(payload.destination)}).`;
    case "emergency:update":
      return `Emergency event ${String(payload.eventId)} is now ${String(payload.status)}.`;
    case "route:updated":
      return `Route calculated for event ${String(payload.eventId)} (${String(payload.segments && Array.isArray(payload.segments) ? payload.segments.length : 0)} segments, ETA ≈ ${String(payload.estimatedTravelTimeS ?? "?")} s).`;
    case "route:switched":
      return `Route switched for event ${String(payload.eventId)}: ${String(payload.reason)} (ETA ${String(payload.oldEtaS)}s → ${String(payload.newEtaS)}s).`;
    case "corridor:created":
      return `Corridor ${String(payload.corridorId)} planned for event ${String(payload.eventId)}.`;
    case "corridor:update": {
      const status = String(payload.status ?? "update");
      const signals = payload.signals;
      const applied = Array.isArray(signals)
        ? (signals as Array<{ status: string }>).filter((signal) => signal.status === "APPLIED").length
        : 0;
      return `Corridor ${String(payload.corridorId)} ${status.toLowerCase()}${applied > 0 ? ` — ${applied} signal(s) commanded` : ""}.`;
    }
    default:
      return type;
  }
}

// Comparison job result helper for the simulator page.
export type { ComparisonResult };
