import type { CongestionLevel } from "@itms/types";

/** Formatting helpers for the command center (all display-only transforms). */

export function formatSpeed(mps: number | null | undefined): string {
  if (mps === null || mps === undefined || !Number.isFinite(mps)) return "—";
  return `${(mps * 3.6).toFixed(0)} km/h`;
}

export function formatMps(mps: number | null | undefined): string {
  if (mps === null || mps === undefined || !Number.isFinite(mps)) return "—";
  return `${mps.toFixed(1)} m/s`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds >= 3600) {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

/** Sim-clock time for an ETA: sim time + offset formatted as HH:MM:SS. */
export function simClock(simTimeSeconds: number | null | undefined, offsetSeconds = 0): string {
  if (simTimeSeconds === null || simTimeSeconds === undefined || !Number.isFinite(simTimeSeconds)) return "—";
  const total = Math.floor(simTimeSeconds + offsetSeconds);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function wallClock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export function ageSeconds(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 1000));
}

export const CONGESTION_COLORS: Record<CongestionLevel, string> = {
  LOW: "#22C55E",
  MEDIUM: "#F59E0B",
  HIGH: "#F97316",
  CRITICAL: "#EF4444",
};

export const CONGESTION_LABELS: Record<CongestionLevel, string> = {
  LOW: "Low",
  MEDIUM: "Moderate",
  HIGH: "High",
  CRITICAL: "Critical",
};

/** Signal RYG string → dominant state + label (label always shown: not color-only). */
export function signalDominant(state: string | undefined | null): { kind: "green" | "yellow" | "red" | "mixed"; label: string; color: string } {
  if (state === undefined || state === null || state.length === 0) {
    return { kind: "mixed", label: "UNKNOWN", color: "#8B95A7" };
  }
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  const reds = (state.match(/[rR]/g) ?? []).length;
  if (greens > 0 && yellows === 0 && reds === 0) return { kind: "green", label: "GREEN", color: "#22C55E" };
  if (yellows > 0 && greens === 0) return { kind: "yellow", label: "YELLOW", color: "#F59E0B" };
  if (reds > 0 && greens === 0 && yellows === 0) return { kind: "red", label: "RED", color: "#EF4444" };
  if (greens > 0 && yellows > 0) return { kind: "mixed", label: "GREEN+YELLOW", color: "#F59E0B" };
  if (greens > 0) return { kind: "mixed", label: `GREEN(${greens})/RED(${reds})`, color: "#38BDF8" };
  return { kind: "mixed", label: "MIXED", color: "#8B95A7" };
}

/** Vehicle id → short display label (emv-<scenario>-<event>-<n> → EMV-n). */
export function vehicleLabel(vehicleId: string): string {
  if (vehicleId.startsWith("emv-")) {
    const parts = vehicleId.split("-");
    return `EMV-${parts[parts.length - 1] ?? vehicleId}`;
  }
  return vehicleId;
}
