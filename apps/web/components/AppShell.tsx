"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { EmergencyEventDetail, SimulationStatusSnapshot } from "@itms/types";
import { useItms } from "@/lib/store";
import { formatSpeed, simClock } from "@/lib/format";
import { StatusDot } from "./ui";

const NAV = [
  { section: "COMMAND CENTER", items: [{ href: "/", label: "Overview", icon: "◉" }] },
  {
    section: "LIVE OPERATIONS",
    items: [
      { href: "/traffic", label: "Traffic", icon: "▤" },
      { href: "/emergencies", label: "Emergencies", icon: "✚" },
      { href: "/signals", label: "Signals", icon: "◈" },
      { href: "/corridors", label: "Corridors", icon: "⇉" },
    ],
  },
  {
    section: "SIMULATION",
    items: [
      { href: "/simulator", label: "Simulator", icon: "▶" },
    ],
  },
  {
    section: "ANALYTICS",
    items: [
      { href: "/analytics", label: "Analytics", icon: "▣" },
      { href: "/decisions", label: "AI Decision Trace", icon: "⌖" },
    ],
  },
  {
    section: "SYSTEM",
    items: [{ href: "/settings", label: "Settings", icon: "⚙" }],
  },
];

const STATUS_COLORS: Record<string, string> = {
  idle: "#8B95A7",
  starting: "#38BDF8",
  running: "#22C55E",
  paused: "#F59E0B",
  stopping: "#F59E0B",
  completed: "#38BDF8",
  error: "#EF4444",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useItms();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const sim = state.sim;

  const hasActiveEmergency = state.emergencies.some(
    (emergency) => emergency.status === "active" || emergency.status === "created",
  );
  const activeCorridor = state.corridors.find((corridor) => corridor.status === "ACTIVE");

  return (
    <div className="flex h-screen flex-col">
      {/* Topbar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#202938] bg-[#0F141D] px-4">
        <div className="flex items-center gap-4">
          <button
            className="rounded border border-[#202938] px-2 py-1 font-mono text-xs text-[#8B95A7] lg:hidden"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            ☰
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-widest text-[#F4F7FA]">ITMS</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-[#8B95A7] md:inline">
              Traffic Command Center
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-5">
          {sim !== null && (
            <span className="hidden font-mono text-[11px] uppercase tracking-wider md:inline" style={{ color: STATUS_COLORS[sim.status] ?? "#8B95A7" }}>
              Sim: {sim.status} · {simClock(sim.simTimeSeconds)}
            </span>
          )}
          <StatusDot
            color={state.connection === "online" ? "#22C55E" : state.connection === "connecting" ? "#F59E0B" : "#EF4444"}
            label={state.connection === "online" ? "System online" : state.connection === "connecting" ? "Connecting" : "Offline"}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-52 shrink-0 flex-col overflow-y-auto border-r border-[#202938] bg-[#0F141D] lg:flex">
          <NavList pathname={pathname} hasActiveEmergency={hasActiveEmergency} activeCorridor={activeCorridor !== undefined} />
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.aside
              initial={{ x: -220 }}
              animate={{ x: 0 }}
              exit={{ x: -220 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-y-12 left-0 z-40 w-52 overflow-y-auto border-r border-[#202938] bg-[#0F141D] lg:hidden"
            >
              <NavList pathname={pathname} hasActiveEmergency={hasActiveEmergency} activeCorridor={activeCorridor !== undefined} onNavigate={() => setMobileNavOpen(false)} />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#080B12]">{children}</main>
      </div>

      {/* KPI bottom bar */}
      <footer className="flex h-11 shrink-0 items-stretch border-t border-[#202938] bg-[#0F141D] font-mono text-[11px]">
        <KpiCell label="Vehicles" value={String(state.traffic?.summary.vehicleCount ?? sim?.vehicleCount ?? "—")} />
        <KpiCell label="Avg speed" value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"} />
        <KpiCell
          label="Congestion"
          value={state.traffic ? congestionLabel(state.traffic) : "—"}
          color={state.traffic ? congestionColor(state.traffic) : undefined}
        />
        <KpiCell label="Queue" value={state.traffic ? String(state.traffic.summary.totalQueueLength) : "—"} />
        <KpiCell
          label="Corridors"
          value={activeCorridor !== undefined ? "ACTIVE" : String(state.corridors.length)}
          color={activeCorridor !== undefined ? "#8B5CF6" : undefined}
        />
        <KpiCell
          label="Emergency"
          value={hasActiveEmergency ? "ACTIVE" : "NONE"}
          color={hasActiveEmergency ? "#FF3B30" : "#8B95A7"}
          pulse={hasActiveEmergency}
        />
        <KpiCell label="ETA" value={activeEta(state.sim, state.emergencies)} />
      </footer>
    </div>
  );
}

function activeEta(sim: SimulationStatusSnapshot | null, emergencies: EmergencyEventDetail[]): string {
  const active = emergencies.find((emergency) => emergency.status === "active" && emergency.etas !== null);
  if (active === undefined || active.etas === null) return "—";
  const destination = active.etas.find((eta) => eta.isDestination) ?? active.etas[active.etas.length - 1];
  if (destination === undefined) return "—";
  const eta = sim !== null ? simClock(sim.simTimeSeconds, destination.etaSeconds) : `${destination.etaSeconds.toFixed(0)}s`;
  return `${eta}${sim !== null ? ` (+${destination.etaSeconds.toFixed(0)}s)` : ""}`;
}

function congestionLabel(traffic: { summary: { cityLevel: string } }): string {
  return traffic.summary.cityLevel;
}

function congestionColor(traffic: { summary: { cityLevel: string } }): string | undefined {
  switch (traffic.summary.cityLevel) {
    case "LOW": return "#22C55E";
    case "MEDIUM": return "#F59E0B";
    case "HIGH": return "#F97316";
    case "CRITICAL": return "#EF4444";
    default: return undefined;
  }
}

function KpiCell({ label, value, color, pulse = false }: { label: string; value: string; color?: string; pulse?: boolean }) {
  return (
    <div className={`flex flex-1 items-center justify-center gap-2 border-r border-[#202938] last:border-0 ${pulse ? "itms-pulse" : ""}`}>
      <span className="text-[#5c6675] uppercase tracking-wider">{label}</span>
      <span className="font-semibold" style={{ color: color ?? "#F4F7FA" }}>
        {value}
      </span>
    </div>
  );
}

function NavList({ pathname, hasActiveEmergency, activeCorridor, onNavigate }: { pathname: string; hasActiveEmergency: boolean; activeCorridor: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4 p-3" aria-label="Main navigation">
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="mb-1 px-2 font-mono text-[9px] uppercase tracking-widest text-[#5c6675]">{group.section}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const emergencyGlow = item.href === "/emergencies" && hasActiveEmergency;
              const corridorGlow = item.href === "/corridors" && activeCorridor;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] transition-colors"
                    style={{
                      background: active ? "rgba(56,189,248,0.08)" : undefined,
                      color: active ? "#38BDF8" : emergencyGlow ? "#FF3B30" : corridorGlow ? "#8B5CF6" : "#8B95A7",
                    }}
                    aria-current={active ? "page" : undefined}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                    {emergencyGlow && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#FF3B30] itms-pulse" aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
