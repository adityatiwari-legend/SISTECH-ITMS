"use client";

import React from "react";
import { EmergencyCountdown } from "./EmergencyCountdown";
import type { DeviceDisplayPayload } from "../types/device";

interface ClearingDisplayProps {
  payload: DeviceDisplayPayload;
}

export function ClearingDisplay({ payload }: ClearingDisplayProps) {
  const vehicle = payload.vehicle;

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-8 select-none text-center bg-gradient-to-b from-neutral-950 via-rose-950/40 to-neutral-950 border-4 border-rose-500 shadow-[inset_0_0_80px_rgba(244,63,94,0.3)] animate-pulse">
      {/* Top Urgent Alert Banner */}
      <div className="mt-8 sm:mt-10 flex flex-col items-center gap-1.5">
        <div className="px-8 py-2.5 rounded-full bg-rose-600/30 border-2 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.6)]">
          <span className="font-mono text-base sm:text-lg font-black text-rose-300 tracking-[0.25em] uppercase">
            🚨 CLEAR INTERSECTION NOW
          </span>
        </div>
        <span className="font-mono text-xs text-rose-400 font-bold uppercase tracking-wider">
          SCREEN #{payload.deviceId.replace(/^CRPD-I0?(\d+).*/i, "$1") || "1"} · {payload.signalName || payload.deviceId} (SIGNAL: {payload.signalId})
        </span>
      </div>

      {/* Main Body */}
      <div className="flex flex-col items-center my-auto py-2">
        <div className="text-7xl sm:text-9xl md:text-[10rem] mb-2 drop-shadow-[0_0_45px_rgba(244,63,94,0.8)]">
          🛑
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-7xl font-black font-mono tracking-tight text-white uppercase drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]">
          CLEAR INTERSECTION
        </h1>

        <div className="text-sm sm:text-base md:text-lg font-mono tracking-widest text-rose-300 font-bold uppercase mt-1">
          CROSS TRAFFIC CLEARING · GREEN CORRIDOR IMMINENT
        </div>

        {/* Large Countdown */}
        <EmergencyCountdown
          etaSeconds={vehicle?.etaSeconds}
          isActive={true}
          totalWindowSeconds={15}
          highlightColor="#f43f5e"
        />

        {/* Telemetry */}
        {vehicle && (
          <div className="flex items-center gap-8 mt-2 font-mono text-base sm:text-lg">
            {vehicle.speedKmh > 0 && (
              <div className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-700">
                <span className="text-xs text-neutral-400 block uppercase">APPROACH SPEED</span>
                <span className="font-black text-rose-400 text-xl sm:text-2xl">{vehicle.speedKmh} km/h</span>
              </div>
            )}
            {vehicle.distanceMeters > 0 && (
              <div className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-700">
                <span className="text-xs text-neutral-400 block uppercase">DISTANCE</span>
                <span className="font-black text-rose-400 text-xl sm:text-2xl">{vehicle.distanceMeters} m</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Notice */}
      <div className="w-full max-w-3xl py-3.5 px-6 rounded-xl bg-rose-950/90 border-2 border-rose-500 shadow-[0_0_35px_rgba(244,63,94,0.4)] mb-2">
        <div className="text-xl sm:text-3xl md:text-4xl font-black font-mono tracking-widest text-white uppercase">
          {payload.message || "CROSS TRAFFIC STOP · CLEAR ROADWAY"}
        </div>
      </div>
    </div>
  );
}
