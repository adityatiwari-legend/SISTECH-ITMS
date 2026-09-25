"use client";

import React from "react";
import { useEmergencyCountdown } from "../hooks/useEmergencyCountdown";

interface EmergencyCountdownProps {
  etaSeconds: number | null | undefined;
  isActive: boolean;
  totalWindowSeconds?: number;
  highlightColor?: string;
  isPassing?: boolean;
}

export function EmergencyCountdown({
  etaSeconds,
  isActive,
  totalWindowSeconds = 30,
  highlightColor = "#10b981",
  isPassing = false,
}: EmergencyCountdownProps) {
  const { etaSeconds: currentEta, formattedCountdown } = useEmergencyCountdown(etaSeconds, isActive);

  if (isPassing || (isActive && currentEta <= 0)) {
    return (
      <div className="flex flex-col items-center justify-center my-3 select-none">
        <div className="text-4xl sm:text-6xl md:text-7xl font-black font-mono tracking-tighter text-amber-300 animate-pulse drop-shadow-[0_0_20px_rgba(252,211,77,0.6)]">
          PASSING NOW
        </div>
        <div className="text-xs sm:text-sm font-mono tracking-widest text-amber-400/80 mt-1 uppercase">
          JUNCTION PREEMPTION ACTIVE
        </div>
      </div>
    );
  }

  // Progress percentage (100% when far, decreasing to 0%)
  const progressPct = Math.min(100, Math.max(0, (currentEta / totalWindowSeconds) * 100));

  return (
    <div className="flex flex-col items-center justify-center my-2 sm:my-4 select-none">
      <div className="text-6xl sm:text-8xl md:text-9xl font-black font-mono tracking-tighter leading-none text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]">
        {formattedCountdown}
      </div>
      <div className="text-sm sm:text-base md:text-lg font-mono tracking-widest text-neutral-400 uppercase mt-2">
        ESTIMATED ARRIVAL (ETA)
      </div>

      {/* High-visibility roadside LED style progress bar */}
      <div className="w-full max-w-md sm:max-w-xl h-3.5 bg-neutral-900/90 rounded-full mt-4 p-0.5 border border-white/20 overflow-hidden shadow-inner">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${progressPct}%`,
            backgroundColor: highlightColor,
            boxShadow: `0 0 16px ${highlightColor}`,
          }}
        />
      </div>
    </div>
  );
}
