"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { fetchDeviceById } from "@/lib/api";
import type { StoredDeviceIdentity } from "@/lib/device-storage";
import { DisplayShell } from "@/components/DisplayShell";
import Link from "next/link";

function DisplayRouteInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deviceParam = searchParams.get("device");

  const [device, setDevice] = useState<StoredDeviceIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceParam) {
      router.replace("/");
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchDeviceById(deviceParam.trim())
      .then((dev) => {
        if (!isMounted) return;
        if (!dev) {
          setError(`Roadside device "${deviceParam}" is not registered in dhaara ITMS.`);
        } else {
          setDevice({
            deviceId: dev.deviceId,
            signalId: dev.signalId,
            deviceName: dev.deviceName,
            configuredAt: new Date().toISOString(),
          });
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : `Failed to load device "${deviceParam}"`);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [deviceParam, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none font-mono">
        <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-6" />
        <h1 className="text-xl font-bold tracking-widest text-zinc-300">dhaara CRPD</h1>
        <p className="text-xs text-zinc-500 mt-2 uppercase tracking-wider">
          Validating Hardware ID: {deviceParam}...
        </p>
      </div>
    );
  }

  if (error || !device) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none font-mono text-center">
        <div className="w-20 h-20 rounded-full border-4 border-red-500/30 bg-red-950/20 flex items-center justify-center mb-6 text-red-500 text-3xl">
          ⚠️
        </div>
        <h1 className="text-3xl font-black tracking-widest text-red-500 uppercase">
          DEVICE NOT REGISTERED
        </h1>
        <p className="text-zinc-400 max-w-md mt-4 text-sm leading-relaxed">
          {error || `Roadside device "${deviceParam}" is not recognized by the central ITMS traffic controller.`}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          <Link
            href="/setup"
            className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-lg border border-zinc-700 transition tracking-wider text-xs uppercase"
          >
            Go to Hardware Setup
          </Link>
          <Link
            href="/"
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-black font-black rounded-lg transition tracking-wider text-xs uppercase"
          >
            Return to Default Display
          </Link>
        </div>
      </div>
    );
  }

  return (
    <DisplayShell
      device={device}
      onChangeDevice={() => router.push("/setup")}
    />
  );
}

export default function DisplayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center font-mono">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <DisplayRouteInner />
    </Suspense>
  );
}
