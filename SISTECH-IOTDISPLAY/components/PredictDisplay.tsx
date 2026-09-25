"use client";

import React from "react";
import { EmergencyCountdown } from "./EmergencyCountdown";
import type { DeviceDisplayPayload } from "../types/device";

interface PredictDisplayProps {
  payload: DeviceDisplayPayload;
}

export function PredictDisplay({ payload }: PredictDisplayProps) {
  const vehicle = payload.vehicle;
  const isAmbulance = !vehicle?.type || vehicle.type === "ambulance";
  const isFire = vehicle?.type === "fire_engine";
  const icon = isAmbulance ? "🚑" : isFire ? "🚒" : "🚓";
  const vehicleTitle = isAmbulance ? "AMBULANCE" : isFire ? "FIRE ENGINE" : "POLICE UNIT";

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 sm:p-8 select-none text-center bg-gradient-to-b from-neutral-950 via-blue-950/20 to-neutral-950 border-4 border-blue-500/40 animate-pulse">
      {/* Top Banner */}
      <div className="mt-8 sm:mt-10 px-6 py-2 rounded-full bg-blue-950/80 border border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
        <span className="font-mono text-xs sm:text-sm font-bold text-blue-300 tracking-[0.25em] uppercase">
          PRIORITY VEHICLE DETECTED
        </span>
      </div>

      {/* Main Vehicle & Action Body */}
      <div className="flex flex-col items-center my-auto py-2">
        <div className="text-6xl sm:text-8xl md:text-9xl mb-3 drop-shadow-[0_0_35px_rgba(59,130,246,0.5)]">
          {icon}
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-black font-mono tracking-wider text-blue-200 uppercase">
          {vehicleTitle}
        </h1>

        <div className="text-xs sm:text-sm md:text-base font-mono tracking-widest text-neutral-400 uppercase mt-1">
          APPROACHING GREEN CORRIDOR
        </div>

        {/* Large Countdown */}
        <EmergencyCountdown
          etaSeconds={vehicle?.etaSeconds}
          isActive={true}
          totalWindowSeconds={60}
          highlightColor="#3b82f6"
        />

        {/* Speed & Distance Stats */}
        {vehicle && (
          <div className="flex items-center gap-6 mt-2 font-mono text-sm sm:text-base text-neutral-300">
            {vehicle.speedKmh > 0 && (
              <div>
                <span className="text-xs text-neutral-500 block uppercase">SPEED</span>
                <span className="font-bold text-white text-lg">{vehicle.speedKmh} km/h</span>
              </div>
            )}
            {vehicle.distanceMeters > 0 && (
              <div>
                <span className="text-xs text-neutral-500 block uppercase">DISTANCE</span>
                <span className="font-bold text-white text-lg">{vehicle.distanceMeters} m</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Roadside Notice */}
      <div className="w-full max-w-2xl py-3 px-6 rounded-xl bg-blue-950/60 border border-blue-500/30 mb-2">
        <div className="text-xl sm:text-2xl md:text-3xl font-black font-mono tracking-widest text-blue-300 uppercase">
          {payload.message || "PREPARE TO GIVE WAY"}
        </div>
      </div>
    </div>
  );
}
