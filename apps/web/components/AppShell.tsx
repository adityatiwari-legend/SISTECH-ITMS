"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useItms } from "@/lib/store";
import { formatSpeed, simClock } from "@/lib/format";
import { StatusDot, StatusChip, Icons } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  badge?: string;
  pulseCondition?: (state: ReturnType<typeof useItms>["state"]) => boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Command Center", icon: Icons.CommandCenter },
  { href: "/simulator", label: "Simulation", icon: Icons.Simulation },
  {
    href: "/emergencies",
    label: "Emergencies",
    icon: Icons.Emergency,
    pulseCondition: (state) =>
      state.emergencies.some((e) => e.status === "active" || e.status === "created"),
  },
  { href: "/signals", label: "Signals", icon: Icons.Signals },
  {
    href: "/corridors",
    label: "Green Corridor",
    icon: Icons.Corridor,
    pulseCondition: (state) => state.corridors.some((c) => c.status === "ACTIVE"),
  },
  { href: "/traffic", label: "Traffic Intelligence", icon: Icons.Traffic },
  { href: "/ai", label: "AI Insights", icon: Icons.AI },
  { href: "/analytics", label: "Analytics", icon: Icons.Analytics },
  { href: "/scenarios", label: "Scenarios", icon: Icons.Scenarios },
];

const SYSTEM_NAV: NavItem[] = [
  { href: "/settings", label: "System / Settings", icon: Icons.Settings },
];

const STATUS_COLORS: Record<string, string> = {
  idle: "#8D9AAA",
  starting: "#42B8FF",
  running: "#18D88B",
  paused: "#FFB547",
  stopping: "#FFB547",
  completed: "#42B8FF",
  error: "#FF4757",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useItms();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const sim = state.sim;

  const hasActiveEmergency = state.emergencies.some(
    (e) => e.status === "active" || e.status === "created"
  );
  const activeCorridor = state.corridors.find((c) => c.status === "ACTIVE");

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#05070B] text-[#F4F7FA]">
      {/* ==================================================================== */}
      {/* GLOBAL TOP SYSTEM BAR                                                */}
      {/* ==================================================================== */}
      <header className="relative z-30 flex h-13 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-4 backdrop-blur-md">
        {/* Left: Mobile Toggle + Logo / Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded border border-[rgba(255,255,255,0.08)] bg-[#0E141D] text-[#8D9AAA] hover:text-[#F4F7FA] lg:hidden"
            aria-label="Toggle navigation menu"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <Link href="/" className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(66,184,255,0.4)] bg-[#0E141D] shadow-[0_0_15px_rgba(66,184,255,0.25)]">
              <span className="h-2 w-2 rounded-full bg-[#18D88B] shadow-[0_0_8px_#18D88B]" />
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#FF3B4E]" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-black tracking-widest text-[#F4F7FA]">
                  ITMS
                </span>
                <span className="rounded bg-[rgba(139,124,255,0.15)] px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#8B7CFF] border border-[rgba(139,124,255,0.3)]">
                  OPS CONTROL
                </span>
              </div>
              <span className="hidden font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A] md:inline">
                Intelligent Traffic Management System
              </span>
            </div>
          </Link>
        </div>

        {/* Center: Live Simulation Status Chip */}
        <div className="hidden items-center gap-3 md:flex">
          {sim ? (
            <div className="flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0E141D] px-3 py-1 font-mono text-[11px]">
              <StatusDot
                color={STATUS_COLORS[sim.status] ?? "#8D9AAA"}
                pulse={sim.status === "running"}
              />
              <span className="uppercase font-semibold tracking-wider" style={{ color: STATUS_COLORS[sim.status] }}>
                {sim.status}
              </span>
              <span className="text-[#5E6B7A]">·</span>
              <span className="text-[#8D9AAA]">{simClock(sim.simTimeSeconds)}</span>
              <span className="text-[#5E6B7A]">·</span>
              <span className="rounded bg-[#121A24] px-1.5 py-0.5 text-[10px] text-[#42B8FF]">
                {sim.paceMultiplier}× SPEED
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.06)] bg-[#0A0F16] px-3 py-1 font-mono text-[11px] text-[#5E6B7A]">
              <StatusDot color="#5E6B7A" />
              <span>SIMULATION IDLE</span>
            </div>
          )}
        </div>

        {/* Right: Technical System Status Indicators */}
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 lg:flex">
            <StatusChip
              label="SYSTEM"
              status={state.systemOnline ? "ONLINE" : "OFFLINE"}
              color={state.systemOnline ? "#18D88B" : "#FF4757"}
              pulse={!state.systemOnline}
            />
            <StatusChip
              label="SUMO"
              status={state.sumoConnected ? "CONNECTED" : "IDLE"}
              color={state.sumoConnected ? "#18D88B" : "#8D9AAA"}
            />
            <StatusChip
              label="TraCI"
              status={state.sumoConnected && state.sim ? "CONNECTED" : "STANDBY"}
              color={state.sumoConnected && state.sim ? "#18D88B" : "#8D9AAA"}
            />
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden h-7 w-7 items-center justify-center rounded border border-[rgba(255,255,255,0.08)] bg-[#0E141D] text-[#8D9AAA] hover:text-[#F4F7FA] lg:flex"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* BODY (SIDEBAR + MAIN CONTENT)                                       */}
      {/* ==================================================================== */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside
          className={`relative z-20 hidden shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#0A0F16] transition-all duration-200 lg:flex ${
            collapsed ? "w-16" : "w-60"
          }`}
        >
          <NavContent
            pathname={pathname}
            collapsed={collapsed}
            hasActiveEmergency={hasActiveEmergency}
            state={state}
          />
        </aside>

        {/* Mobile Navigation Drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                initial={{ x: -260 }}
                animate={{ x: 0 }}
                exit={{ x: -260 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#0A0F16] shadow-2xl lg:hidden"
              >
                <div className="flex h-13 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#F4F7FA]">
                    ITMS NAVIGATION
                  </span>
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="rounded p-1 text-[#8D9AAA] hover:text-[#F4F7FA]"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <NavContent
                  pathname={pathname}
                  collapsed={false}
                  hasActiveEmergency={hasActiveEmergency}
                  state={state}
                  onNavigate={() => setMobileOpen(false)}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content Fluid Canvas */}
        <main className="relative z-10 min-w-0 flex-1 overflow-y-auto bg-[#05070B]">
          {children}
        </main>
      </div>

      {/* ==================================================================== */}
      {/* GLOBAL SYSTEM KPI FOOTER STRIP                                       */}
      {/* ==================================================================== */}
      <footer className="relative z-30 flex h-10 shrink-0 items-stretch border-t border-[rgba(255,255,255,0.08)] bg-[#0A0F16] font-mono text-[11px]">
        <KpiCell
          label="TRAFFIC"
          value={String(state.traffic?.summary.vehicleCount ?? sim?.vehicleCount ?? "—")}
          sub="vehicles"
        />
        <KpiCell
          label="AVG SPEED"
          value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"}
        />
        <KpiCell
          label="CONGESTION"
          value={state.traffic?.summary.cityLevel ?? "NOMINAL"}
          color={
            state.traffic?.summary.cityLevel === "CRITICAL"
              ? "#FF4757"
              : state.traffic?.summary.cityLevel === "HIGH"
              ? "#FFB547"
              : "#18D88B"
          }
        />
        <KpiCell
          label="QUEUE"
          value={state.traffic ? String(state.traffic.summary.totalQueueLength) : "—"}
        />
        <KpiCell
          label="SIGNALS"
          value={`${state.signals.length} ACTIVE`}
          color="#42B8FF"
        />
        <KpiCell
          label="CORRIDOR"
          value={activeCorridor ? `ACTIVE (#${activeCorridor.id})` : "STANDBY"}
          color={activeCorridor ? "#8B7CFF" : "#5E6B7A"}
          pulse={activeCorridor !== undefined}
        />
        <KpiCell
          label="EMERGENCY"
          value={hasActiveEmergency ? "PRIORITY ACTIVE" : "NONE"}
          color={hasActiveEmergency ? "#FF3B4E" : "#5E6B7A"}
          pulse={hasActiveEmergency}
        />
      </footer>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  color,
  pulse = false,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 border-r border-[rgba(255,255,255,0.06)] px-2 last:border-0">
      {pulse && <span className="h-1.5 w-1.5 animate-ping rounded-full" style={{ backgroundColor: color ?? "#18D88B" }} />}
      <span className="text-[10px] uppercase tracking-wider text-[#5E6B7A]">{label}:</span>
      <span className="font-semibold" style={{ color: color ?? "#F4F7FA" }}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-[#5E6B7A]">{sub}</span>}
    </div>
  );
}

function NavContent({
  pathname,
  collapsed,
  hasActiveEmergency,
  state,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  hasActiveEmergency: boolean;
  state: ReturnType<typeof useItms>["state"];
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto py-3">
      {/* Primary Operations Nav */}
      <div className="flex flex-col gap-1 px-2">
        {!collapsed && (
          <div className="mb-1.5 px-3 font-mono text-[9px] font-semibold uppercase tracking-widest text-[#5E6B7A]">
            Operations
          </div>
        )}
        <nav className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === "/ai" && pathname === "/decisions");
            const Icon = item.icon;
            const isPulsing = item.pulseCondition ? item.pulseCondition(state) : false;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#121A24] text-[#F4F7FA] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-[#8D9AAA] hover:bg-[#0E141D] hover:text-[#F4F7FA]"
                }`}
              >
                {/* Active Left Indicator Bar */}
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-indicator"
                    className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#42B8FF] shadow-[0_0_8px_#42B8FF]"
                    transition={{ duration: 0.18 }}
                  />
                )}

                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                    isActive ? "text-[#42B8FF]" : "text-[#8D9AAA] group-hover:text-[#F4F7FA]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>

                {!collapsed && <span className="truncate">{item.label}</span>}

                {/* Pulsing Alert Pip for Emergency or Corridor */}
                {isPulsing && (
                  <span
                    className={`ml-auto h-1.5 w-1.5 rounded-full ${
                      item.href === "/emergencies" ? "bg-[#FF3B4E] shadow-[0_0_6px_#FF3B4E]" : "bg-[#8B7CFF] shadow-[0_0_6px_#8B7CFF]"
                    } animate-ping`}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* System & Settings Nav at Bottom */}
      <div className="flex flex-col gap-2 border-t border-[rgba(255,255,255,0.08)] px-2 pt-3">
        {!collapsed && (
          <div className="px-3 font-mono text-[9px] font-semibold uppercase tracking-widest text-[#5E6B7A]">
            Administration
          </div>
        )}
        <nav className="flex flex-col gap-0.5">
          {SYSTEM_NAV.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#121A24] text-[#F4F7FA] font-semibold"
                    : "text-[#8D9AAA] hover:bg-[#0E141D] hover:text-[#F4F7FA]"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#42B8FF]" />
                )}
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#8D9AAA] group-hover:text-[#F4F7FA]">
                  <Icon className="h-4 w-4" />
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="mt-2 rounded border border-[rgba(255,255,255,0.06)] bg-[#05070B] p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
                System Mode
              </span>
              <span className="font-mono text-[9px] font-bold text-[#18D88B]">
                SUMO TWIN
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-[#8D9AAA] truncate">
              {hasActiveEmergency ? "🚑 Emergency Corridors En Route" : "Nominal Autonomous Control"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
