"use client";

import React, { useState, useEffect } from "react";
import { fetchSignals, fetchDevices, registerDeviceApi, type SignalSummary } from "../lib/api";
import { getApiBaseUrl, getWebSocketUrl } from "../lib/config";
import type { StoredDeviceIdentity } from "../lib/device-storage";
import type { RoadsideDeviceRecord } from "../types/device";

interface DeviceSetupProps {
  currentDevice?: StoredDeviceIdentity | null;
  onConfigured: (device: StoredDeviceIdentity) => void;
  onCancel?: () => void;
}

export function DeviceSetup({ currentDevice, onConfigured, onCancel }: DeviceSetupProps) {
  const [signals, setSignals] = useState<SignalSummary[]>([]);
  const [registeredDevices, setRegisteredDevices] = useState<RoadsideDeviceRecord[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string>("");
  const [customDeviceId, setCustomDeviceId] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable connection URLs (for testing over phone LAN or ngrok)
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [loadedSignals, loadedDevices] = await Promise.all([
          fetchSignals().catch(() => []),
          fetchDevices().catch(() => []),
        ]);

        setSignals(loadedSignals);
        setRegisteredDevices(loadedDevices);

        if (currentDevice) {
          setSelectedSignalId(currentDevice.signalId);
          setCustomDeviceId(currentDevice.deviceId);
          setCustomName(currentDevice.deviceName);
        } else {
          // Default to Link Road Commercial Hub
          setSelectedSignalId("315577777");
          setCustomDeviceId("CRPD-I01-01");
          setCustomName("Link Road Commercial Hub Roadside Priority Display");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load signals from backend");
      } finally {
        setIsLoading(false);
      }
    }

    void loadData();
  }, [currentDevice]);

  // Curated and discovered signals for clear selection
  const signalOptions = React.useMemo(() => {
    const list: Array<{ signalId: string; deviceId: string; name: string }> = [];
    const seen = new Set<string>();

    // Canonical priority signals (Link Road and Hospital Junction) first
    list.push({
      signalId: "315577777",
      deviceId: "CRPD-I01-01",
      name: "Link Road Commercial Hub",
    });
    seen.add("315577777");

    list.push({
      signalId: "315577785",
      deviceId: "CRPD-I03-01",
      name: "Hospital Junction",
    });
    seen.add("315577785");

    // Existing registered devices from server
    for (const dev of registeredDevices) {
      if (!seen.has(dev.signalId)) {
        seen.add(dev.signalId);
        list.push({
          signalId: dev.signalId,
          deviceId: dev.deviceId,
          name: dev.deviceName || `Signal ${dev.signalId} Roadside Display`,
        });
      }
    }

    // Any other signals from /api/signals
    for (const sig of signals) {
      if (!seen.has(sig.id)) {
        seen.add(sig.id);
        const clean = sig.id.replace(/[^A-Za-z0-9]/g, "");
        list.push({
          signalId: sig.id,
          deviceId: `CRPD-${clean}-01`,
          name: `Intersection ${sig.id} (Program: ${sig.program})`,
        });
      }
    }

    return list;
  }, [registeredDevices, signals]);

  // When signal changes, auto-fill matching device or generate ID
  const handleSignalChange = (sigId: string) => {
    setSelectedSignalId(sigId);

    const opt = signalOptions.find((o) => o.signalId === sigId);
    if (opt) {
      setCustomDeviceId(opt.deviceId);
      setCustomName(
        opt.name.includes("Display") ? opt.name : `${opt.name} Roadside Priority Display`
      );
    } else {
      const clean = sigId.replace(/[^A-Za-z0-9]/g, "");
      setCustomDeviceId(`CRPD-${clean}-01`);
      setCustomName(`Signal ${sigId} Roadside Priority Display`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSignalId || !customDeviceId) {
      setError("Please select an intersection and device ID.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (apiBaseUrl && typeof window !== "undefined") {
        localStorage.setItem("itms_api_base_url", apiBaseUrl.trim());
      }

      const snapshot = await registerDeviceApi({
        deviceId: customDeviceId.trim(),
        signalId: selectedSignalId.trim(),
        deviceName: customName.trim(),
        deviceType: "SIMULATED_DISPLAY",
      });

      const identity: StoredDeviceIdentity = {
        deviceId: snapshot.device.deviceId,
        signalId: snapshot.device.signalId,
        deviceName: snapshot.device.deviceName,
        configuredAt: new Date().toISOString(),
      };

      onConfigured(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register device");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto select-none">
      <div className="w-full max-w-lg rounded-2xl bg-neutral-900 border border-neutral-700/80 p-6 sm:p-8 shadow-2xl animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <h2 className="font-mono text-sm font-bold text-neutral-300 tracking-widest uppercase">
                dhaara ITMS
              </h2>
            </div>
            <h1 className="text-xl sm:text-2xl font-black font-mono text-white mt-1">
              CONFIGURE ROADSIDE DISPLAY
            </h1>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              type="button"
              className="text-neutral-400 hover:text-white font-mono text-sm p-2 rounded hover:bg-neutral-800"
            >
              ✕
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 mb-6 rounded-lg bg-rose-950/60 border border-rose-500/50 text-rose-300 text-xs sm:text-sm font-mono">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400 font-mono text-sm">
            <span className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full"></span>
            <span>DISCOVERING CONTROLLED SIGNALS...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Intersection Picker */}
            <div>
              <label className="block text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider mb-2">
                SELECT INTERSECTION (REAL SUMO SIGNALS)
              </label>

              <select
                value={selectedSignalId}
                onChange={(e) => handleSignalChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-700 text-white font-mono text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                required
              >
                <option value="" disabled>
                  -- Select a Controlled Traffic Signal --
                </option>
                {signalOptions.map((opt) => (
                  <option key={opt.signalId} value={opt.signalId}>
                    {opt.name} · Signal ID: {opt.signalId} ({opt.deviceId})
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] font-mono text-neutral-500">
                Matches the authoritative signals loaded in Bhopal / ITMS simulation.
              </p>
            </div>

            {/* Device Identity Code */}
            <div>
              <label className="block text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider mb-2">
                DEVICE IDENTIFIER (CRPD-...)
              </label>
              <input
                type="text"
                value={customDeviceId}
                onChange={(e) => setCustomDeviceId(e.target.value)}
                placeholder="e.g. CRPD-I01-01"
                className="w-full px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-700 text-white font-mono text-sm focus:outline-none focus:border-emerald-500 transition-colors uppercase"
                required
              />
            </div>

            {/* Display Friendly Name */}
            <div>
              <label className="block text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider mb-2">
                DISPLAY NAME
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Hospital Junction Priority Display"
                className="w-full px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-700 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                required
              />
            </div>

            {/* Advanced Connection Settings Toggle */}
            <div className="border-t border-neutral-800 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs font-mono text-neutral-400 hover:text-emerald-400 flex items-center gap-1.5 transition-colors"
              >
                <span>{showAdvanced ? "▼ HIDE" : "▶ CONFIGURE"}</span>
                <span>BACKEND CONNECTION URL</span>
              </button>

              {showAdvanced && (
                <div className="mt-3 p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 space-y-3">
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 uppercase mb-1">
                      API BASE URL
                    </label>
                    <input
                      type="url"
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                      placeholder="https://sleep-utensil-afternoon.ngrok-free.dev"
                      className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-neutral-200"
                    />
                    <p className="mt-1 text-[10px] font-mono text-neutral-500">
                      Use ngrok public URL or LAN IP (e.g. http://192.168.1.50:3000) for phone access.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 py-3 px-4 rounded-xl border border-neutral-700 text-neutral-300 hover:bg-neutral-800 font-mono text-sm font-bold transition-colors"
                >
                  CANCEL
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-mono text-sm font-black tracking-wider uppercase transition-colors shadow-[0_0_20px_rgba(16,185,129,0.4)] disabled:opacity-50"
              >
                {isSubmitting ? "ACTIVATING..." : "ACTIVATE DISPLAY"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
