"use client";

import React from "react";
import { EmergencyCountdown } from "./EmergencyCountdown";
import type { DeviceDisplayPayload } from "../types/device";

interface PassingDisplayProps {
  payload: DeviceDisplayPayload;
}

export function PassingDisplay({ payload }: PassingDisplayProps) {
  const vehicle = payload.vehicle;

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-8 select-none text-center bg-gradient-to-b from-neutral-950 via-amber-950/60 to-neutral-950 border-4 sm:border-8 border-amber-400 shadow-[inset_0_0_120px_rgba(251,191,36,0.4)] animate-pulse">
      {/* Top Banner */}
      <div className="mt-8 sm:mt-10 flex flex-col items-center gap-2">
        <div className="px-8 py-2.5 rounded-full bg-amber-500/30 border-2 border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.8)]">
          <span className="font-mono text-base sm:text-xl font-black text-amber-200 tracking-[0.25em] uppercase">
            🚨 HIGH PRIORITY VEHICLE CROSSING NOW
          </span>
        </div>
        {payload.signalName && (
          <span className="font-mono text-xs text-amber-300 font-bold uppercase tracking-wider">
            {payload.signalName} (SIGNAL: {payload.signalId})
          </span>
        )}
      </div>

      {/* Main Urgent Passing Banner */}
      <div className="flex flex-col items-center my-auto py-2">
        <div className="text-8xl sm:text-9xl md:text-[11rem] mb-2 animate-bounce drop-shadow-[0_0_60px_rgba(251,191,36,0.9)]">
          🚑
        </div>

        <EmergencyCountdown
          etaSeconds={0}
          isActive={true}
          isPassing={true}
          highlightColor="#fbbf24"
        />

        <div className="text-xl sm:text-3xl md:text-4xl font-black font-mono tracking-wider text-white uppercase mt-2">
          KEEP INTERSECTION CLEAR
        </div>

        {vehicle && vehicle.speedKmh > 0 && (
          <div className="mt-4 px-6 py-2 rounded-xl bg-neutral-900/90 border border-amber-400/40 font-mono">
            <span className="text-xs text-neutral-400 block uppercase">PASSING SPEED</span>
            <span className="font-black text-amber-300 text-2xl sm:text-3xl">{vehicle.speedKmh} km/h</span>
          </div>
        )}
      </div>

      {/* Bottom Emergency Instruction */}
      <div className="w-full max-w-3xl py-4 px-8 rounded-2xl bg-amber-950/90 border-2 sm:border-4 border-amber-400 shadow-[0_0_40px_rgba(251,191,36,0.6)] mb-2">
        <div className="text-2xl sm:text-4xl md:text-5xl font-black font-mono tracking-widest text-white uppercase">
          {payload.message || "KEEP INTERSECTION CLEAR"}
        </div>
      </div>
    </div>
  );
}
