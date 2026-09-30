"use client";

import React from "react";
import { EmergencyCountdown } from "./EmergencyCountdown";
import type { DeviceDisplayPayload } from "../types/device";

interface GreenDisplayProps {
  payload: DeviceDisplayPayload;
}

export function GreenDisplay({ payload }: GreenDisplayProps) {
  const vehicle = payload.vehicle;
  const isAmbulance = !vehicle?.type || vehicle.type === "ambulance";
  const isFire = vehicle?.type === "fire_engine";
  const icon = isAmbulance ? "🚑" : isFire ? "🚒" : "🚓";
  const vehicleTitle = isAmbulance ? "AMBULANCE" : isFire ? "FIRE ENGINE" : "POLICE UNIT";

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-8 select-none text-center bg-gradient-to-b from-neutral-950 via-emerald-950/40 to-neutral-950 border-4 sm:border-8 border-emerald-400 shadow-[inset_0_0_100px_rgba(16,185,129,0.35)]">
      {/* Top Emerald Header */}
      <div className="mt-8 sm:mt-10 flex flex-col items-center gap-2">
        <div className="px-8 py-3 rounded-full bg-emerald-500/30 border-2 border-emerald-400 shadow-[0_0_35px_rgba(16,185,129,0.7)] animate-pulse">
          <span className="font-mono text-base sm:text-xl font-black text-emerald-200 tracking-[0.25em] uppercase">
            🟢 GREEN CORRIDOR ACTIVE
          </span>
        </div>
        <span className="font-mono text-xs text-emerald-300 font-bold uppercase tracking-wider">
          SCREEN #{payload.deviceId.replace(/^CRPD-I0?(\d+).*/i, "$1") || "1"} · {payload.signalName || payload.deviceId} (SIGNAL: {payload.signalId})
        </span>
      </div>

      {/* Main Vehicle & Countdown Body */}
      <div className="flex flex-col items-center my-auto py-2">
        <div className="text-7xl sm:text-9xl md:text-[10rem] mb-2 drop-shadow-[0_0_50px_rgba(16,185,129,0.8)] animate-pulse">
          {icon}
        </div>

        <h1 className="text-3xl sm:text-6xl md:text-7xl font-black font-mono tracking-tight text-white uppercase drop-shadow-[0_0_30px_rgba(16,185,129,0.5)]">
          {vehicleTitle} ARRIVING
        </h1>

        <div className="text-sm sm:text-base md:text-xl font-mono tracking-widest text-emerald-300 font-bold uppercase mt-1">
          TRAFFIC SIGNALS PREEMPTED FOR EMERGENCY
        </div>

        {/* Large Countdown */}
        <EmergencyCountdown
          etaSeconds={vehicle?.etaSeconds}
          isActive={true}
          totalWindowSeconds={20}
          highlightColor="#10b981"
        />

        {/* Real Vehicle Speed & Distance */}
        {vehicle && (
          <div className="flex items-center gap-8 mt-2 font-mono text-base sm:text-lg">
            {vehicle.speedKmh > 0 && (
              <div className="px-5 py-2.5 rounded-xl bg-neutral-900/90 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <span className="text-xs text-neutral-400 block uppercase">CURRENT SPEED</span>
                <span className="font-black text-emerald-300 text-2xl sm:text-3xl">{vehicle.speedKmh} km/h</span>
              </div>
            )}
            {vehicle.distanceMeters > 0 && (
              <div className="px-5 py-2.5 rounded-xl bg-neutral-900/90 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <span className="text-xs text-neutral-400 block uppercase">DISTANCE</span>
                <span className="font-black text-emerald-300 text-2xl sm:text-3xl">{vehicle.distanceMeters} m</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Roadside Action Banner */}
      <div className="w-full max-w-4xl py-4 px-8 rounded-2xl bg-emerald-950/90 border-2 sm:border-4 border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.5)] mb-2 animate-bounce">
        <div className="text-2xl sm:text-4xl md:text-5xl font-black font-mono tracking-widest text-white uppercase drop-shadow-[0_0_15px_rgba(255,255,255,0.7)]">
          {payload.message || "PLEASE GIVE WAY"}
        </div>
      </div>
    </div>
  );
}
