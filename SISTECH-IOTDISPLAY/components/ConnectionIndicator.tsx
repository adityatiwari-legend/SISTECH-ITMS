"use client";

import React from "react";
import { isAudioAlertEnabled, setAudioAlertEnabled } from "../lib/device-storage";

interface ConnectionIndicatorProps {
  isConnected: boolean;
  isReconnecting: boolean;
  deviceId: string;
  signalName?: string;
  onOpenSetup?: () => void;
}

export function ConnectionIndicator({
  isConnected,
  isReconnecting,
  deviceId,
  signalName,
  onOpenSetup,
}: ConnectionIndicatorProps) {
  const [audioEnabled, setAudioEnabled] = React.useState(false);

  React.useEffect(() => {
    setAudioEnabled(isAudioAlertEnabled());
  }, []);

  const toggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    setAudioAlertEnabled(next);
  };

  const screenNum = React.useMemo(() => {
    const m = deviceId.match(/CRPD-I0?(\d+)/i);
    return m ? m[1] : "1";
  }, [deviceId]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2.5 bg-black/60 backdrop-blur-md border-b border-white/10 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {isConnected ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
              </>
            ) : isReconnecting ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
            )}
          </span>
          <span className="font-mono text-xs font-semibold tracking-wider text-neutral-300 uppercase">
            {isConnected ? "CONNECTED" : isReconnecting ? "RECONNECTING" : "OFFLINE"}
          </span>
        </div>

        <span className="text-neutral-600 font-mono text-xs">|</span>

        {/* High visibility Screen Number Badge */}
        <span className="px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-400/70 text-cyan-300 font-mono text-xs font-black tracking-wider shadow-[0_0_12px_rgba(6,182,212,0.4)] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          SCREEN #{screenNum}
        </span>

        <span className="font-mono text-xs font-bold text-neutral-200 tracking-wider">
          {deviceId}
        </span>

        {signalName && (
          <span className="hidden sm:inline text-xs text-neutral-400 truncate max-w-xs">
            · {signalName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleAudio}
          type="button"
          title={audioEnabled ? "Alert Sound: ON" : "Alert Sound: OFF"}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-colors border ${
            audioEnabled
              ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
              : "bg-neutral-900 border-neutral-700/60 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <span>{audioEnabled ? "🔔 AUDIO ON" : "🔕 AUDIO OFF"}</span>
        </button>

        {onOpenSetup && (
          <button
            onClick={onOpenSetup}
            type="button"
            className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700/60 text-neutral-300 hover:text-white text-xs font-mono transition-colors"
          >
            ⚙ CHANGE
          </button>
        )}
      </div>
    </header>
  );
}
