"use client";

import React from "react";
import { EmergencyCountdown } from "./EmergencyCountdown";
import type { DeviceDisplayPayload } from "../types/device";

interface PreparingDisplayProps {
  payload: DeviceDisplayPayload;
}

export function PreparingDisplay({ payload }: PreparingDisplayProps) {
  const vehicle = payload.vehicle;
  const isAmbulance = !vehicle?.type || vehicle.type === "ambulance";
  const isFire = vehicle?.type === "fire_engine";
  const icon = isAmbulance ? "🚑" : isFire ? "🚒" : "🚓";
  const vehicleTitle = isAmbulance ? "AMBULANCE" : isFire ? "FIRE ENGINE" : "POLICE UNIT";

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-8 select-none text-center bg-gradient-to-b from-neutral-950 via-amber-950/30 to-neutral-950 border-4 border-amber-500 shadow-[inset_0_0_60px_rgba(245,158,11,0.2)]">
      {/* Top Banner */}
      <div className="mt-8 sm:mt-10 flex flex-col items-center gap-1.5">
        <div className="px-8 py-2.5 rounded-full bg-amber-500/20 border-2 border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.4)] animate-pulse">
          <span className="font-mono text-sm sm:text-base font-black text-amber-300 tracking-[0.25em] uppercase">
            ⚠ HIGH PRIORITY VEHICLE APPROACHING
          </span>
        </div>
        <span className="font-mono text-xs text-amber-400 font-bold uppercase tracking-wider">
          SCREEN #{payload.deviceId.replace(/^CRPD-I0?(\d+).*/i, "$1") || "1"} · {payload.signalName || payload.deviceId} (SIGNAL: {payload.signalId})
        </span>
      </div>

      {/* Main Vehicle & Telemetry Body */}
      <div className="flex flex-col items-center my-auto py-2">
        <div className="text-7xl sm:text-9xl md:text-[10rem] mb-2 drop-shadow-[0_0_40px_rgba(245,158,11,0.6)] animate-bounce">
          {icon}
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-black font-mono tracking-tight text-white uppercase">
          {vehicleTitle} APPROACHING
        </h1>

        {/* Large Countdown */}
        <EmergencyCountdown
          etaSeconds={vehicle?.etaSeconds}
          isActive={true}
          totalWindowSeconds={30}
          highlightColor="#f59e0b"
        />

        {/* Real Vehicle Speed & Distance */}
        {vehicle && (
          <div className="flex items-center gap-8 mt-2 font-mono text-base sm:text-lg">
            {vehicle.speedKmh > 0 && (
              <div className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-700">
                <span className="text-xs text-neutral-400 block uppercase">SPEED</span>
                <span className="font-black text-amber-400 text-xl sm:text-2xl">{vehicle.speedKmh} km/h</span>
              </div>
            )}
            {vehicle.distanceMeters > 0 && (
              <div className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-700">
                <span className="text-xs text-neutral-400 block uppercase">DISTANCE</span>
                <span className="font-black text-amber-400 text-xl sm:text-2xl">{vehicle.distanceMeters} m</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Roadside Action Command */}
      <div className="w-full max-w-3xl py-3 px-6 rounded-xl bg-amber-950/80 border-2 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)] mb-2">
        <div className="text-xl sm:text-3xl md:text-4xl font-black font-mono tracking-widest text-amber-300 uppercase">
          {payload.message || "PLEASE PREPARE TO GIVE WAY"}
        </div>
      </div>
    </div>
  );
}
