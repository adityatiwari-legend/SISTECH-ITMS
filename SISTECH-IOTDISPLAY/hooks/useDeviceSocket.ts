"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getWebSocketUrl } from "../lib/config";
import { fetchDeviceState } from "../lib/api";
import { playWarningTone, playPassingAlert } from "../lib/audio";
import { isAudioAlertEnabled } from "../lib/device-storage";
import type { DeviceDisplayPayload, DeviceDisplayState } from "../types/device";

interface UseDeviceSocketProps {
  deviceId: string | null;
  signalId?: string;
  deviceName?: string;
}

export function useDeviceSocket({ deviceId, signalId, deviceName }: UseDeviceSocketProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showOfflineAlert, setShowOfflineAlert] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [displayPayload, setDisplayPayload] = useState<DeviceDisplayPayload | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);
  const stableTimer = useRef<NodeJS.Timeout | null>(null);
  const offlineAlertTimer = useRef<NodeJS.Timeout | null>(null);
  const prevStateRef = useRef<DeviceDisplayState | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Screen Wake Lock API
  useEffect(() => {
    async function requestWakeLock() {
      if (typeof window !== "undefined" && "wakeLock" in navigator) {
        try {
          const lock = await (navigator as any).wakeLock.request("screen");
          wakeLockRef.current = lock;
        } catch {
          // Wake lock unavailable or denied
        }
      }
    }
    void requestWakeLock();

    return () => {
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch {
          // ignored
        }
        wakeLockRef.current = null;
      }
    };
  }, []);

  // Fetch authoritative initial state snapshot
  const syncAuthoritativeState = useCallback(async (devId: string) => {
    try {
      const snapshot = await fetchDeviceState(devId);
      if (snapshot && snapshot.display) {
        setDisplayPayload(snapshot.display);
        prevStateRef.current = snapshot.display.displayState;
      }
    } catch {
      // Best effort fallback to default idle
    }
  }, []);

  const connect = useCallback(() => {
    if (!deviceId || typeof window === "undefined") return;

    if (socketRef.current) {
      if (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      try {
        socketRef.current.close();
      } catch {
        // ignored
      }
      socketRef.current = null;
    }

    const wsUrl = getWebSocketUrl();
    const urlWithParam = `${wsUrl}?deviceId=${encodeURIComponent(deviceId)}`;

    try {
      const socket = new WebSocket(urlWithParam);
      socketRef.current = socket;

      socket.onopen = async () => {
        setIsConnected(true);
        setLastHeartbeat(new Date());

        // Cancel offline alert banner
        if (offlineAlertTimer.current) {
          clearTimeout(offlineAlertTimer.current);
          offlineAlertTimer.current = null;
        }
        setShowOfflineAlert(false);

        // Mark connection stable after 3 seconds of continuous connectivity
        if (stableTimer.current) clearTimeout(stableTimer.current);
        stableTimer.current = setTimeout(() => {
          reconnectAttempt.current = 0;
          setIsReconnecting(false);
        }, 3000);

        // 1. Sync authoritative state snapshot
        await syncAuthoritativeState(deviceId);

        // 2. Send device:connect identification frame
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "device:connect",
              deviceId,
              clientType: "ROADSIDE_DISPLAY",
            })
          );
        }

        // 3. Periodic heartbeat confirmation
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "device:heartbeat",
                deviceId,
                timestamp: Date.now(),
              })
            );
            setLastHeartbeat(new Date());
          }
        }, 15_000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "heartbeat") {
            setLastHeartbeat(new Date());
            return;
          }

          if (msg.type === "device:display") {
            const payload = msg as DeviceDisplayPayload;
            if (!payload.deviceId || payload.deviceId === deviceId) {
              setDisplayPayload(payload);

              // Sound alert on state transition if audio enabled
              const newState = payload.displayState;
              const oldState = prevStateRef.current;
              if (oldState !== newState && isAudioAlertEnabled()) {
                if (newState === "PREPARING" || newState === "CLEARING") {
                  playWarningTone();
                } else if (newState === "PASSING") {
                  playPassingAlert();
                }
              }
              prevStateRef.current = newState;
            }
          }
        } catch {
          // non-json frame
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (stableTimer.current) {
          clearTimeout(stableTimer.current);
          stableTimer.current = null;
        }
        if (heartbeatTimer.current) {
          clearInterval(heartbeatTimer.current);
          heartbeatTimer.current = null;
        }

        // Grace period before flashing offline banner (prevents 1s strobing)
        if (!offlineAlertTimer.current) {
          offlineAlertTimer.current = setTimeout(() => {
            setShowOfflineAlert(true);
          }, 2000);
        }

        // Exponential backoff reconnect: 1s, 2s, 3s, capped at 10s
        setIsReconnecting(true);
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempt.current), 10_000);
        reconnectAttempt.current += 1;

        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      };

      socket.onerror = () => {
        try {
          socket.close();
        } catch {
          // ignored
        }
      };
    } catch {
      setIsConnected(false);
      setIsReconnecting(true);
      if (!offlineAlertTimer.current) {
        offlineAlertTimer.current = setTimeout(() => {
          setShowOfflineAlert(true);
        }, 2000);
      }
    }
  }, [deviceId, syncAuthoritativeState]);

  useEffect(() => {
    connect();

    return () => {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // ignored
        }
        socketRef.current = null;
      }
    };
  }, [connect]);

  // Fallback idle display if no message arrived yet
  const effectiveDisplay = displayPayload ?? {
    type: "device:display",
    deviceId: deviceId || "CRPD-UNCONFIGURED",
    signalId: signalId || "—",
    signalName: deviceName || "Roadside Priority Display",
    displayState: "IDLE",
    message: "NORMAL TRAFFIC",
    vehicle: null,
    corridor: null,
    timestamp: new Date().toISOString(),
  };

  return {
    isConnected,
    isReconnecting,
    showOfflineAlert,
    lastHeartbeat,
    display: effectiveDisplay,
    reconnect: connect,
  };
}
