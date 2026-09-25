"use client";

import { useState, useEffect, useRef } from "react";

export function useEmergencyCountdown(backendEtaSeconds: number | null | undefined, isActive: boolean) {
  const [displayEta, setDisplayEta] = useState<number>(backendEtaSeconds ?? 0);
  const lastAuthoritativeEta = useRef<number | null>(backendEtaSeconds ?? null);
  const lastSyncTimestamp = useRef<number>(Date.now());

  // Correct whenever backend sends a new authoritative ETA
  useEffect(() => {
    if (backendEtaSeconds !== undefined && backendEtaSeconds !== null) {
      lastAuthoritativeEta.current = backendEtaSeconds;
      lastSyncTimestamp.current = Date.now();
      setDisplayEta(backendEtaSeconds);
    } else {
      lastAuthoritativeEta.current = null;
      setDisplayEta(0);
    }
  }, [backendEtaSeconds]);

  // Smooth interpolation tick every 200ms
  useEffect(() => {
    if (!isActive || lastAuthoritativeEta.current === null) return;

    const interval = setInterval(() => {
      const elapsedSeconds = (Date.now() - lastSyncTimestamp.current) / 1000;
      const base = lastAuthoritativeEta.current ?? 0;
      const interpolated = Math.max(0, Math.round(base - elapsedSeconds));
      setDisplayEta(interpolated);
    }, 200);

    return () => clearInterval(interval);
  }, [isActive]);

  const minutes = Math.floor(displayEta / 60);
  const seconds = displayEta % 60;
  const formattedCountdown = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return {
    etaSeconds: displayEta,
    formattedCountdown,
  };
}
