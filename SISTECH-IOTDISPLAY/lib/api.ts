import { getApiBaseUrl } from "./config";
import type { DeviceStateSnapshot, RoadsideDeviceRecord } from "../types/device";

const NGROK_HEADER = { "ngrok-skip-browser-warning": "69420" };

export interface SignalSummary {
  id: string;
  program: string;
  state: string;
  phaseDurationSeconds: number;
}

export async function fetchSignals(): Promise<SignalSummary[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/signals`, {
    headers: { ...NGROK_HEADER, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch signals: ${res.statusText}`);
  }
  const data = (await res.json()) as { signals?: SignalSummary[] };
  return data.signals || [];
}

export async function fetchDevices(): Promise<RoadsideDeviceRecord[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/devices`, {
    headers: { ...NGROK_HEADER, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch devices: ${res.statusText}`);
  }
  const data = (await res.json()) as { devices?: RoadsideDeviceRecord[] };
  return data.devices || [];
}

export async function fetchDeviceById(deviceId: string): Promise<RoadsideDeviceRecord | null> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}`, {
    headers: { ...NGROK_HEADER, Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Device lookup failed: ${res.statusText}`);
  }
  const data = (await res.json()) as { device?: RoadsideDeviceRecord };
  return data.device || null;
}

export async function fetchDeviceState(deviceId: string): Promise<DeviceStateSnapshot> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/state`, {
    headers: { ...NGROK_HEADER, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Device state fetch failed (${res.status})`);
  }
  return (await res.json()) as DeviceStateSnapshot;
}

export async function registerDeviceApi(payload: {
  deviceId: string;
  signalId: string;
  deviceName?: string;
  deviceType?: "SIMULATED_DISPLAY" | "PHYSICAL_DISPLAY";
}): Promise<DeviceStateSnapshot> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/devices/register`, {
    method: "POST",
    headers: {
      ...NGROK_HEADER,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errData?.error?.message || `Registration failed (${res.status})`);
  }
  return (await res.json()) as DeviceStateSnapshot;
}

export async function sendDeviceHeartbeat(deviceId: string): Promise<void> {
  const base = getApiBaseUrl();
  await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/heartbeat`, {
    method: "POST",
    headers: { ...NGROK_HEADER, "Content-Type": "application/json" },
  }).catch(() => {
    // heartbeat is best-effort
  });
}

export async function resetDeviceApi(deviceId: string): Promise<DeviceStateSnapshot> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/reset`, {
    method: "POST",
    headers: { ...NGROK_HEADER, "Content-Type": "application/json" },
  });
  return (await res.json()) as DeviceStateSnapshot;
}
