"use client";

import React from "react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none font-mono text-center">
      <div className="w-20 h-20 rounded-full border-4 border-amber-500/30 bg-amber-950/20 flex items-center justify-center mb-6 text-amber-500 text-3xl">
        📡
      </div>
      <h1 className="text-3xl font-black tracking-widest text-amber-500 uppercase">
        NETWORK OFFLINE
      </h1>
      <p className="text-zinc-400 max-w-md mt-4 text-sm leading-relaxed">
        This roadside priority display cannot reach local or cloud ITMS networks. Please verify Wi-Fi, Ethernet, or cellular uplink.
      </p>
      <div className="mt-8">
        <Link
          href="/"
          className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-lg border border-zinc-700 transition tracking-wider text-xs uppercase"
        >
          Retry Connection
        </Link>
      </div>
    </div>
  );
}
