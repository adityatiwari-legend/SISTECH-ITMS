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
  { section: null, items: [{ href: "/", label: "Overview", icon: "◉" }] },
  {
    section: "Live operations",
    items: [
      { href: "/traffic", label: "Traffic", icon: "▤" },
      { href: "/emergencies", label: "Emergencies", icon: "✚" },
      { href: "/signals", label: "Signals", icon: "◈" },
      { href: "/corridors", label: "Corridors", icon: "⇉" },
    ],
  },
  {
    section: "Simulation",
    items: [
      { href: "/simulator", label: "Simulator", icon: "▶" },
    ],
  },
  {
    section: "Analytics",
    items: [
      { href: "/analytics", label: "Analytics", icon: "▣" },
      { href: "/decisions", label: "AI Decision Trace", icon: "⌖" },
    ],
  },
  {
    section: "System",
    items: [{ href: "/settings", label: "Settings", icon: "⚙" }],
  },
];

const STATUS_COLORS: Record<string, string> = {
  idle: "#8B95A9",
  starting: "#67e8f9",
  running: "#34d399",
  paused: "#fbbf24",
  stopping: "#fbbf24",
  completed: "#67e8f9",
  error: "#f87171",
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
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-[rgba(148,163,190,0.12)] bg-[rgba(10,13,20,0.82)] px-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            className="rounded-lg border border-[rgba(148,163,190,0.16)] px-2 py-1 font-mono text-xs text-[#8B95A9] lg:hidden"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            ☰
          </button>
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-lg font-mono text-[11px] font-black text-white"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
                boxShadow: "0 0 16px rgba(139,92,246,0.45)",
              }}
              aria-hidden="true"
            >
              T
            </span>
            <span className="font-mono text-sm font-bold tracking-widest text-[#EEF2F9]">ITMS</span>
            <span className="hidden rounded-md border border-[rgba(148,163,190,0.14)] bg-[rgba(148,163,190,0.06)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#8B95A9] md:inline">
              Traffic Command Center
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {sim !== null && (
            <span
              className="hidden font-mono text-[11px] uppercase tracking-wider md:inline"
              style={{ color: STATUS_COLORS[sim.status] ?? "#8B95A9" }}
            >
              ● {sim.status} · {simClock(sim.simTimeSeconds)} · {sim.paceMultiplier}×
            </span>
          )}
          <StatusDot
            color={state.connection === "online" ? "#34d399" : state.connection === "connecting" ? "#fbbf24" : "#f87171"}
            label={state.connection === "online" ? "Online" : state.connection === "connecting" ? "Connecting" : "Offline"}
            pulse={state.connection !== "online"}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        <aside className="relative z-20 hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-[rgba(148,163,190,0.1)] bg-[rgba(9,12,18,0.7)] lg:flex">
          <SidebarHeader sim={sim} />
          <NavList pathname={pathname} hasActiveEmergency={hasActiveEmergency} activeCorridor={activeCorridor !== undefined} />
          <SidebarFooter hasActiveEmergency={hasActiveEmergency} activeCorridor={activeCorridor} />
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileNavOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                onClick={() => setMobileNavOpen(false)}
              />
              <motion.aside
                initial={{ x: -240 }}
                animate={{ x: 0 }}
                exit={{ x: -240 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed inset-y-12 left-0 z-40 w-56 overflow-y-auto border-r border-[rgba(148,163,190,0.14)] bg-[#0a0d14] lg:hidden"
              >
                <SidebarHeader sim={sim} />
                <NavList
                  pathname={pathname}
                  hasActiveEmergency={hasActiveEmergency}
                  activeCorridor={activeCorridor !== undefined}
                  onNavigate={() => setMobileNavOpen(false)}
                />
                <SidebarFooter hasActiveEmergency={hasActiveEmergency} activeCorridor={activeCorridor} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className="relative z-10 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* KPI bottom bar */}
      <footer className="relative z-30 flex h-11 shrink-0 items-stretch border-t border-[rgba(148,163,190,0.12)] bg-[rgba(10,13,20,0.85)] font-mono text-[11px] backdrop-blur-xl">
        <KpiCell label="Vehicles" value={String(state.traffic?.summary.vehicleCount ?? sim?.vehicleCount ?? "—")} />
        <KpiCell label="Avg speed" value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"} />
        <KpiCell
          label="Congestion"
          value={state.traffic ? state.traffic.summary.cityLevel : "—"}
          color={state.traffic ? congestionColor(state.traffic.summary.cityLevel) : undefined}
        />
        <KpiCell label="Queue" value={state.traffic ? String(state.traffic.summary.totalQueueLength) : "—"} />
        <KpiCell
          label="Corridors"
          value={activeCorridor !== undefined ? "ACTIVE" : String(state.corridors.length)}
          color={activeCorridor !== undefined ? "#a78bfa" : undefined}
        />
        <KpiCell
          label="Emergency"
          value={hasActiveEmergency ? "ACTIVE" : "NONE"}
          color={hasActiveEmergency ? "#ff453a" : "#8B95A9"}
          pulse={hasActiveEmergency}
        />
        <KpiCell label="ETA" value={activeEta(state.sim, state.emergencies)} />
      </footer>
    </div>
  );
}

function congestionColor(level: string): string | undefined {  switch (level) {
    case "LOW": return "#34d399";
    case "MEDIUM": return "#fbbf24";
    case "HIGH": return "#fb923c";
    case "CRITICAL": return "#f87171";
    default: return undefined;
  }
}

function activeEta(sim: SimulationStatusSnapshot | null, emergencies: EmergencyEventDetail[]): string {
  const active = emergencies.find((emergency) => emergency.status === "active" && emergency.etas !== null);
  if (active === undefined || active.etas === null) return "—";
  const destination = active.etas.find((eta) => eta.isDestination) ?? active.etas[active.etas.length - 1];
  if (destination === undefined) return "—";
  const offset = destination.etaSeconds;
  const eta = sim !== null ? simClock(sim.simTimeSeconds, offset) : `${offset.toFixed(0)}s`;
  return `${eta}${sim !== null ? ` (+${offset.toFixed(0)}s)` : ""}`;
}

function KpiCell({ label, value, color, pulse = false }: { label: string; value: string; color?: string; pulse?: boolean }) {
  return (
    <div className={`flex flex-1 items-center justify-center gap-2 border-r border-[rgba(148,163,190,0.08)] last:border-0 ${pulse ? "itms-pulse" : ""}`}>
      <span className="text-[#5c6675] uppercase tracking-wider">{label}</span>
      <span className="font-semibold" style={{ color: color ?? "#EEF2F9" }}>
        {value}
      </span>
    </div>
  );
}

function SidebarHeader({ sim }: { sim: SimulationStatusSnapshot | null }) {
  return (
    <div className="border-b border-[rgba(148,163,190,0.08)] px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-[#5c6675]">Simulation</div>
      <div className="mt-1 font-mono text-[12px] text-[#EEF2F9]">{sim?.scenario ?? "not started"}</div>
      <div className="mt-1 font-mono text-[10px] text-[#6B7385]">
        {sim !== null ? `${sim.vehicleCount} vehicles · ${sim.stepLengthSeconds}s steps` : "idle"}
      </div>
    </div>
  );
}

function SidebarFooter({ hasActiveEmergency, activeCorridor }: { hasActiveEmergency: boolean; activeCorridor?: { id: number } }) {
  return (
    <div className="mt-auto border-t border-[rgba(148,163,190,0.1)] px-4 py-3">
      {hasActiveEmergency ? (
        <div className="itms-pulse rounded-lg border border-[rgba(255,69,58,0.4)] bg-[rgba(255,69,58,0.08)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-[#ff453a]">
          🚑 Emergency active
        </div>
      ) : activeCorridor !== undefined ? (
        <div className="rounded-lg border border-[rgba(167,139,250,0.4)] bg-[rgba(167,139,250,0.08)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-[#a78bfa]">
          ⇉ Corridor {activeCorridor.id} active
        </div>
      ) : (
        <div className="rounded-lg border border-[rgba(148,163,190,0.12)] bg-[rgba(148,163,190,0.04)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-[#6B7385]">
          ◦ Nominal operation
        </div>
      )}
    </div>
  );
}

function NavList({ pathname, hasActiveEmergency, activeCorridor, onNavigate }: { pathname: string; hasActiveEmergency: boolean; activeCorridor: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 p-3" aria-label="Main navigation">
      {NAV.map((group, groupIndex) => (
        <div key={groupIndex}>
          {group.section !== null && (
            <div className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-widest text-[#5c6675]">{group.section}</div>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const emergencyGlow = item.href === "/emergencies" && hasActiveEmergency;
              const corridorGlow = item.href === "/corridors" && activeCorridor;
              const color = active ? "#67e8f9" : emergencyGlow ? "#ff453a" : corridorGlow ? "#a78bfa" : "#8B95A9";
              return (
                <li key={item.href} className="relative">
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-lg border border-[rgba(103,232,249,0.28)] bg-[rgba(103,232,249,0.08)]"
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      aria-hidden="true"
                    />
                  )}
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className="relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition-colors"
                    style={{ color }}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="w-4 text-center opacity-80" aria-hidden="true">{item.icon}</span>
                    {item.label}
                    {(emergencyGlow || corridorGlow) && (
                      <span
                        className="ml-auto inline-block h-1.5 w-1.5 rounded-full itms-pulse"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                    )}
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
