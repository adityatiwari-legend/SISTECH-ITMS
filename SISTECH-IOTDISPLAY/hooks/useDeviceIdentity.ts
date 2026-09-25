"use client";

import { useState, useEffect, useCallback } from "react";
import { getStoredDevice, saveStoredDevice, clearStoredDevice, type StoredDeviceIdentity } from "../lib/device-storage";
import { fetchDeviceState } from "../lib/api";

export function useDeviceIdentity(queryDeviceParam?: string | null) {
  const [device, setDevice] = useState<StoredDeviceIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initIdentity() {
      setIsLoading(true);
      setError(null);

      // 1. Check if URL specifies device e.g. /display?device=CRPD-I01-01
      if (queryDeviceParam && queryDeviceParam.trim()) {
        try {
          const snapshot = await fetchDeviceState(queryDeviceParam.trim());
          if (!cancelled) {
            const identity: StoredDeviceIdentity = {
              deviceId: snapshot.device.deviceId,
              signalId: snapshot.device.signalId,
              deviceName: snapshot.device.deviceName,
              configuredAt: new Date().toISOString(),
            };
            setDevice(identity);
            saveStoredDevice(identity);
            setIsLoading(false);
            return;
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Device not found on server");
          }
        }
      }

      // 2. Fall back to local storage
      const stored = getStoredDevice();
      if (!cancelled) {
        setDevice(stored);
        setIsLoading(false);
      }
    }

    void initIdentity();

    return () => {
      cancelled = true;
    };
  }, [queryDeviceParam]);

  const updateIdentity = useCallback((identity: StoredDeviceIdentity) => {
    saveStoredDevice(identity);
    setDevice(identity);
    setError(null);
  }, []);

  const resetIdentity = useCallback(() => {
    clearStoredDevice();
    setDevice(null);
  }, []);

  return {
    device,
    isConfigured: Boolean(device),
    isLoading,
    error,
    updateIdentity,
    resetIdentity,
  };
}
