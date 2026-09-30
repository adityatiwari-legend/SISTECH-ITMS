"use client";

import React from "react";
import type { DeviceDisplayPayload } from "../types/device";

interface IdleDisplayProps {
  payload: DeviceDisplayPayload;
  signalName?: string;
  deviceId: string;
}

export function IdleDisplay({ payload, signalName, deviceId }: IdleDisplayProps) {
  const [timeStr, setTimeStr] = React.useState("");

  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-6 sm:p-10 select-none text-center animate-fadeIn">
      {/* Brand & Infrastructure Header */}
      <div className="flex flex-col items-center gap-1.5 mt-8 sm:mt-12">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="font-mono text-sm sm:text-base tracking-[0.3em] font-bold text-neutral-300 uppercase">
            dhaara ITMS
          </span>
        </div>
        <h2 className="text-xs sm:text-sm font-mono tracking-widest text-neutral-300 uppercase">
          CONNECTED ROADSIDE PRIORITY DISPLAY (CRPD)
        </h2>
        {/* High visibility Screen Number Banner */}
        <div className="mt-2 px-5 py-1.5 rounded-full bg-cyan-950/80 border border-cyan-400/60 text-cyan-300 font-mono text-xs sm:text-sm font-bold tracking-widest shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>SCREEN #{deviceId.replace(/^CRPD-I0?(\d+).*/i, "$1") || "1"}: {payload?.signalName || signalName || "Link Road Commercial Hub"}</span>
        </div>
      </div>

      {/* Main Calm State */}
      <div className="flex flex-col items-center my-auto py-8">
        <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full border-2 border-emerald-500/30 bg-emerald-950/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
          <span className="text-4xl sm:text-5xl">🟢</span>
        </div>

        <h1 className="text-4xl sm:text-6xl md:text-7xl font-black font-mono tracking-wider text-neutral-100 uppercase">
          NORMAL TRAFFIC
        </h1>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-900 border border-neutral-800">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-mono text-xs text-neutral-300 font-semibold tracking-wider uppercase">
              PRIORITY RADAR ACTIVE
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-900 border border-neutral-800">
            <span className="font-mono text-xs text-neutral-400 tracking-wider uppercase">
              SIGNAL:
            </span>
            <span className="font-mono text-xs font-bold text-emerald-400">
              {payload.signalState
                ? /[gG]/.test(payload.signalState)
                  ? "🟢 GREEN PHASE"
                  : /[yY]/.test(payload.signalState)
                  ? "🟡 YELLOW TRANSITION"
                  : "🔴 RED PHASE"
                : "🟢 NORMAL CYCLE"}
            </span>
          </div>
        </div>

        {timeStr && (
          <div className="mt-6 font-mono text-xl sm:text-2xl text-neutral-300 font-light tracking-widest">
            {timeStr}
          </div>
        )}
      </div>

      {/* Footer Location Identity */}
      <div className="mb-2 sm:mb-4 flex flex-col items-center gap-1 border-t border-neutral-800/80 pt-4 w-full max-w-lg">
        <div className="text-sm sm:text-base font-mono font-bold text-neutral-300 tracking-wider">
          {signalName || payload.signalName || "Intersection Gateway"}
        </div>
        <div className="text-xs font-mono text-neutral-300">
          SIGNAL ID: {payload.signalId} · DEVICE: {deviceId}
        </div>
      </div>
    </div>
  );
}
