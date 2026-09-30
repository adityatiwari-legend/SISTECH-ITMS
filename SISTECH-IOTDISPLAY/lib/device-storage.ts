/**
 * Local device identity persistence
 */

export interface StoredDeviceIdentity {
  deviceId: string;
  signalId: string;
  deviceName: string;
  configuredAt: string;
}

const STORAGE_KEY = "sistech_crpd_identity";
const AUDIO_KEY = "sistech_crpd_audio";

export function getStoredDevice(): StoredDeviceIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDeviceIdentity;
  } catch {
    return null;
  }
}

export function saveStoredDevice(identity: StoredDeviceIdentity): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // quota exceeded or private mode
  }
}

export function clearStoredDevice(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function isAudioAlertEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const val = localStorage.getItem(AUDIO_KEY);
  return val === null ? true : val === "true";
}

export function setAudioAlertEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUDIO_KEY, enabled ? "true" : "false");
}
