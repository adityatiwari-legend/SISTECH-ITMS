"use client";

import React, { useState } from "react";
import { useDeviceIdentity } from "@/hooks/useDeviceIdentity";
import { DisplayShell } from "@/components/DisplayShell";
import { DeviceSetup } from "@/components/DeviceSetup";
import type { StoredDeviceIdentity } from "@/lib/device-storage";

export default function HomePage() {
  const { device, isLoading, updateIdentity, resetIdentity } = useDeviceIdentity();
  const [showSetup, setShowSetup] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none font-mono">
        <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-6" />
        <h1 className="text-xl font-bold tracking-widest text-zinc-300">SISTECH ITMS</h1>
        <p className="text-xs text-zinc-500 mt-2 uppercase tracking-wider">
          Initializing Roadside Priority Display...
        </p>
      </div>
    );
  }

  // If no device configured or user explicitly requested setup
  if (!device || showSetup) {
    return (
      <DeviceSetup
        currentDevice={device}
        onConfigured={(configuredIdentity: StoredDeviceIdentity) => {
          updateIdentity(configuredIdentity);
          setShowSetup(false);
        }}
        onCancel={device ? () => setShowSetup(false) : undefined}
      />
    );
  }

  return (
    <DisplayShell
      device={device}
      onUpdateDevice={updateIdentity}
      onChangeDevice={() => setShowSetup(true)}
    />
  );
}
