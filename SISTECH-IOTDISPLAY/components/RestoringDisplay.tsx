"use client";

import React from "react";
import type { DeviceDisplayPayload } from "../types/device";

interface RestoringDisplayProps {
  payload: DeviceDisplayPayload;
}

export function RestoringDisplay({ payload }: RestoringDisplayProps) {
  const isCancelled = payload.displayState === "CANCELLED";

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-6 sm:p-10 select-none text-center bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 border-4 border-neutral-700/60 animate-fadeIn">
      {/* Top Banner */}
      <div className="mt-8 sm:mt-12 px-6 py-2 rounded-full bg-neutral-900 border border-neutral-700">
        <span className="font-mono text-xs sm:text-sm font-semibold text-neutral-400 tracking-[0.25em] uppercase">
          {isCancelled ? "CORRIDOR CANCELLED" : "INTERSECTION CLEAR"}
        </span>
      </div>

      {/* Main Restoring Body */}
      <div className="flex flex-col items-center my-auto py-4">
        <div className="text-7xl sm:text-9xl mb-4 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
          {isCancelled ? "ℹ" : "✓"}
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-black font-mono tracking-wider text-neutral-100 uppercase">
          {isCancelled ? "CORRIDOR CANCELLED" : "VEHICLE PASSED"}
        </h1>

        <div className="text-base sm:text-xl font-mono tracking-widest text-emerald-400 font-semibold uppercase mt-3">
          NORMAL TRAFFIC RESUMING
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs sm:text-sm font-mono text-neutral-500">
          <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-neutral-500 border-t-emerald-400 rounded-full"></span>
          <span>RESTORING FIXED TIMING CYCLES...</span>
        </div>
      </div>

      {/* Bottom Roadside Notice */}
      <div className="w-full max-w-xl py-3 px-6 rounded-xl bg-neutral-900/80 border border-neutral-800 mb-2">
        <div className="text-lg sm:text-xl font-mono font-bold tracking-wider text-neutral-300 uppercase">
          {payload.message || "THANK YOU FOR GIVING WAY"}
        </div>
      </div>
    </div>
  );
}
