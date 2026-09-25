"use client";

import React, { useState } from "react";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { IdleDisplay } from "./IdleDisplay";
import { PredictDisplay } from "./PredictDisplay";
import { PreparingDisplay } from "./PreparingDisplay";
import { ClearingDisplay } from "./ClearingDisplay";
import { GreenDisplay } from "./GreenDisplay";
import { PassingDisplay } from "./PassingDisplay";
import { RestoringDisplay } from "./RestoringDisplay";
import { DeviceSetup } from "./DeviceSetup";
import { useDeviceSocket } from "../hooks/useDeviceSocket";
import type { DeviceDisplayPayload } from "../types/device";
import type { StoredDeviceIdentity } from "../lib/device-storage";

interface DisplayShellProps {
  device: StoredDeviceIdentity;
  onUpdateDevice?: (device: StoredDeviceIdentity) => void;
  onChangeDevice?: () => void;
}

export function DisplayShell({
  device,
  onUpdateDevice,
  onChangeDevice,
}: DisplayShellProps) {
  const [showSetup, setShowSetup] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { isConnected, isReconnecting, showOfflineAlert, display: displayPayload } = useDeviceSocket({
    deviceId: device.deviceId,
    signalId: device.signalId,
    deviceName: device.deviceName,
  });

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const renderActiveDisplay = () => {
    switch (displayPayload.displayState) {
      case "PREDICT":
        return <PredictDisplay payload={displayPayload} />;
      case "PREPARING":
        return <PreparingDisplay payload={displayPayload} />;
      case "CLEARING":
        return <ClearingDisplay payload={displayPayload} />;
      case "GREEN":
        return <GreenDisplay payload={displayPayload} />;
      case "PASSING":
        return <PassingDisplay payload={displayPayload} />;
      case "PASSED":
      case "RESTORING":
      case "CANCELLED":
        return <RestoringDisplay payload={displayPayload} />;
      case "IDLE":
      default:
        return (
          <IdleDisplay
            payload={displayPayload}
            signalName={device.deviceName}
            deviceId={device.deviceId}
          />
        );
    }
  };

  return (
    <main className="relative flex flex-col w-screen h-screen min-h-screen bg-black text-white overflow-hidden select-none">
      {/* Top Fixed Connection Header */}
      <ConnectionIndicator
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        deviceId={device.deviceId}
        signalName={device.deviceName}
        onOpenSetup={onChangeDevice ? onChangeDevice : () => setShowSetup(true)}
      />

      {/* Disconnection Attention Banner (Section 30) - debounced so no 1s strobing */}
      {showOfflineAlert && (
        <div className="fixed top-11 left-0 right-0 z-40 bg-rose-600 text-white py-2 px-4 flex items-center justify-center gap-3 font-mono text-xs sm:text-sm font-bold tracking-wider animate-pulse shadow-lg">
          <span>⚠ CONNECTION LOST · LIVE TRAFFIC DATA UNAVAILABLE · ATTEMPTING TO RECONNECT...</span>
        </div>
      )}

      {/* Central Screen Area (Dynamic State Machine) */}
      <div className="flex-1 flex flex-col w-full h-full pt-12 pb-8 sm:pb-10 overflow-hidden">
        {renderActiveDisplay()}
      </div>

      {/* Fullscreen Floating Toggle in bottom right */}
      <div className="fixed bottom-3 right-3 z-30">
        <button
          onClick={toggleFullscreen}
          type="button"
          className="p-2.5 rounded-full bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white transition-colors backdrop-blur-sm shadow-md"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            )}
          </svg>
        </button>
      </div>

      {/* Device Configuration Modal */}
      {showSetup && (
        <DeviceSetup
          currentDevice={device}
          onConfigured={(newDevice) => {
            if (onUpdateDevice) onUpdateDevice(newDevice);
            setShowSetup(false);
          }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </main>
  );
}
