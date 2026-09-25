"use client";

import React from "react";
import { motion } from "framer-motion";

/**
 * ITMS DESIGN SYSTEM — CORE TECHNICAL UI PRIMITIVES
 * Built for mission control, dark operations dashboards, high contrast,
 * semantic color coding, and accessible keyboard focus.
 */

// ---------------------------------------------------------------------------
// 1. Status Indicators & Badges
// ---------------------------------------------------------------------------

export function StatusDot({
  color,
  label,
  pulse = false,
  className = "",
}: {
  color: string;
  label?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono ${className}`}>
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
          aria-hidden="true"
        />
        {pulse && (
          <span
            className="absolute -inset-1 animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        )}
      </span>
      {label && (
        <span className="text-[11px] font-medium tracking-wide uppercase text-[#8D9AAA]">
          {label}
        </span>
      )}
    </span>
  );
}

export function StatusChip({
  label,
  status,
  color,
  pulse = false,
}: {
  label: string;
  status: string;
  color?: string;
  pulse?: boolean;
}) {
  const activeColor = color ?? "#18D88B";
  return (
    <div className="inline-flex items-center gap-2 rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-2.5 py-1 font-mono text-[11px]">
      <StatusDot color={activeColor} pulse={pulse} />
      <span className="text-[#5E6B7A] uppercase text-[10px] tracking-wider">{label}</span>
      <span className="font-semibold" style={{ color: activeColor }}>
        {status}
      </span>
    </div>
  );
}

export function Badge({
  children,
  color = "#42B8FF",
  solid = false,
  className = "",
}: {
  children: React.ReactNode;
  color?: string;
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase ${className} ${
        solid ? "text-[#05070B]" : "border"
      }`}
      style={
        solid
          ? { backgroundColor: color, boxShadow: `0 0 12px ${color}55` }
          : {
              borderColor: `${color}44`,
              color: color,
              backgroundColor: `${color}14`,
            }
      }
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 2. Metrics & KPI Cards
// ---------------------------------------------------------------------------

export function MetricCard({
  label,
  value,
  trend,
  trendPositive = true,
  sub,
  color,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  trend?: string;
  trendPositive?: boolean;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="itms-panel itms-hover p-3.5 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#5E6B7A]">
          {label}
        </span>
        {icon && <span className="text-[#8D9AAA] text-sm">{icon}</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="font-mono text-2xl font-bold tracking-tight text-[#F4F7FA]"
          style={color ? { color } : undefined}
        >
          {value}
        </span>
        {trend && (
          <span
            className={`font-mono text-[10px] font-semibold ${
              trendPositive ? "text-[#18D88B]" : "text-[#FF4757]"
            }`}
          >
            {trend}
          </span>
        )}
      </div>
      {sub && <span className="mt-1 text-[11px] text-[#8D9AAA] truncate">{sub}</span>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  color,
  trend,
  trendPositive = true,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  trend?: string;
  trendPositive?: boolean;
}) {
  return (
    <div className="itms-panel itms-hover p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#5E6B7A]">
          {label}
        </span>
        {trend && (
          <span
            className={`font-mono text-[10px] font-semibold ${
              trendPositive ? "text-[#18D88B]" : "text-[#FF4757]"
            }`}
          >
            {trend}
          </span>
        )}
      </div>
      <div
        className="mt-1 font-mono text-xl font-bold tracking-tight text-[#F4F7FA]"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[#8D9AAA]">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Technical Progress Bar
// ---------------------------------------------------------------------------

export function ProgressBar({
  progress,
  color = "#18D88B",
  height = 6,
  showLabel = false,
}: {
  progress: number; // 0 to 100
  color?: string;
  height?: number;
  showLabel?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, progress));
  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-full bg-[#121A24] border border-[rgba(255,255,255,0.06)]"
        style={{ height }}
      >
        <motion.div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-[#8D9AAA]">
          <span>Progress</span>
          <span className="font-semibold text-[#F4F7FA]">{Math.round(clamped)}%</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Panel Container with Header
// ---------------------------------------------------------------------------

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
  elevated = false,
  emergency = false,
  ai = false,
  success = false,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  emergency?: boolean;
  ai?: boolean;
  success?: boolean;
}) {
  const borderColor = emergency
    ? "rgba(255, 59, 78, 0.45)"
    : ai
    ? "rgba(139, 124, 255, 0.4)"
    : success
    ? "rgba(24, 216, 139, 0.35)"
    : undefined;

  const headerBorder = emergency
    ? "rgba(255, 59, 78, 0.2)"
    : ai
    ? "rgba(139, 124, 255, 0.18)"
    : "rgba(255, 255, 255, 0.08)";

  const titleColor = emergency
    ? "#FF3B4E"
    : ai
    ? "#8B7CFF"
    : success
    ? "#18D88B"
    : "#F4F7FA";

  return (
    <section
      className={`${elevated ? "itms-panel-elevated" : "itms-panel"} overflow-hidden ${className}`}
      style={borderColor ? { borderColor } : undefined}
    >
      {title && (
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: headerBorder }}
        >
          <div>
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: titleColor }}>
              {title}
            </h2>
            {subtitle && <p className="text-[10px] text-[#5E6B7A] mt-0.5">{subtitle}</p>}
          </div>
          {right && <div className="flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Buttons & Actions
// ---------------------------------------------------------------------------

export function ActionButton({
  children,
  onClick,
  color = "#42B8FF",
  disabled = false,
  type = "button",
  title,
  filled = false,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  filled?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses =
    size === "sm"
      ? "px-2 py-1 text-[10px]"
      : size === "lg"
      ? "px-4 py-2 text-xs"
      : "px-3 py-1.5 text-[11px]";

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded border font-mono font-semibold uppercase tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-40 ${sizeClasses}`}
      style={
        filled
          ? {
              backgroundColor: color,
              borderColor: color,
              color: "#05070B",
              boxShadow: `0 0 16px ${color}44`,
            }
          : {
              borderColor: `${color}55`,
              color,
              backgroundColor: `${color}14`,
            }
      }
    >
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// 6. Data Row / KeyValue
// ---------------------------------------------------------------------------

export function KeyValue({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] py-1.5 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-wider text-[#5E6B7A]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-medium text-[#F4F7FA]">{children}</span>
        {action}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Realistic Traffic Light Visualizer
// ---------------------------------------------------------------------------

export function SignalLightVisual({
  state,
  orientation = "horizontal",
  size = "md",
}: {
  state: string; // TraCI state string, e.g. "GGrr", "yy", "rr"
  orientation?: "horizontal" | "vertical";
  size?: "sm" | "md" | "lg";
}) {
  const isGreen = /[gG]/.test(state);
  const isYellow = /[yY]/.test(state);
  const isRed = !isGreen && !isYellow;

  const lampSize = size === "sm" ? "h-2 w-2" : size === "lg" ? "h-3.5 w-3.5" : "h-2.5 w-2.5";
  const housingPad = size === "sm" ? "p-1 gap-1" : "p-1.5 gap-1.5";

  return (
    <div
      className={`inline-flex items-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[#05070B] shadow-inner ${housingPad} ${
        orientation === "vertical" ? "flex-col" : "flex-row"
      }`}
      aria-label={`Signal state: ${isGreen ? "Green" : isYellow ? "Yellow" : "Red"}`}
    >
      {/* Red Light */}
      <span
        className={`rounded-full transition-all duration-200 ${lampSize}`}
        style={
          isRed
            ? {
                backgroundColor: "#FF3B4E",
                boxShadow: "0 0 10px #FF3B4E, inset 0 0 2px #FFF",
              }
            : { backgroundColor: "#3A1116", opacity: 0.4 }
        }
      />
      {/* Yellow Light */}
      <span
        className={`rounded-full transition-all duration-200 ${lampSize}`}
        style={
          isYellow
            ? {
                backgroundColor: "#FFB547",
                boxShadow: "0 0 10px #FFB547, inset 0 0 2px #FFF",
              }
            : { backgroundColor: "#36270E", opacity: 0.4 }
        }
      />
      {/* Green Light */}
      <span
        className={`rounded-full transition-all duration-200 ${lampSize}`}
        style={
          isGreen
            ? {
                backgroundColor: "#18D88B",
                boxShadow: "0 0 10px #18D88B, inset 0 0 2px #FFF",
              }
            : { backgroundColor: "#0C3020", opacity: 0.4 }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Empty, Loading, and Error States
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0E141D] text-[#8D9AAA]">
        {icon ?? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        )}
      </div>
      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#F4F7FA]">
        {title}
      </div>
      {hint && <p className="max-w-sm text-[11px] leading-relaxed text-[#5E6B7A]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading data" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12" role="status">
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="inline-block h-full w-full animate-spin rounded-full border-2 border-[rgba(255,255,255,0.12)] border-t-[#42B8FF]" />
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-[#8D9AAA]">
        {label}…
      </span>
    </div>
  );
}

export function SkeletonLoader({ rows = 3, height = "h-4" }: { rows?: number; height?: string }) {
  return (
    <div className="flex flex-col gap-2.5 py-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`w-full animate-pulse rounded bg-[#121A24] ${height}`}
          style={{ opacity: 1 - index * 0.2 }}
        />
      ))}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  retry,
}: {
  title: string;
  detail?: string | null;
  retry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" role="alert">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(255,71,87,0.3)] bg-[rgba(255,71,87,0.1)] text-[#FF4757]">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#FF4757]">
        {title}
      </div>
      {detail && <p className="max-w-md text-[11px] leading-relaxed text-[#8D9AAA]">{detail}</p>}
      {retry && (
        <button
          onClick={retry}
          className="mt-2 rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#F4F7FA] transition-colors hover:border-[#42B8FF] hover:text-[#42B8FF]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function DisconnectedBanner({ detail }: { detail?: string | null }) {
  return (
    <div
      className="flex items-center justify-between rounded border border-[rgba(255,71,87,0.4)] bg-[rgba(255,71,87,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#FF4757]"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-ping rounded-full bg-[#FF4757]" />
        <span>BACKEND DISCONNECTED — {detail ?? "Waiting for API reconnect…"}</span>
      </div>
    </div>
  );
}

export function StaleBanner({ label = "Simulation telemetry paused or stale" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded border border-[rgba(255,181,71,0.35)] bg-[rgba(255,181,71,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#FFB547]"
      role="status"
    >
      <span className="h-2 w-2 rounded-full bg-[#FFB547]" />
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9. Page Header Primitive
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[11px] text-[#5E6B7A]">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// 10. Technical SVG Icons
// ---------------------------------------------------------------------------

export const Icons = {
  CommandCenter: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  Simulation: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Emergency: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  Signals: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <rect x="7" y="2" width="10" height="20" rx="3" strokeWidth={1.75} />
      <circle cx="12" cy="7" r="1.5" strokeWidth={1.5} />
      <circle cx="12" cy="12" r="1.5" strokeWidth={1.5} />
      <circle cx="12" cy="17" r="1.5" strokeWidth={1.5} />
    </svg>
  ),
  Corridor: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
    </svg>
  ),
  Traffic: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  AI: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Analytics: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Scenarios: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  ),
  Settings: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" strokeWidth={1.75} />
    </svg>
  ),
  RoadsideDevice: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  ZoomIn: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  ZoomOut: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
  ),
  FitView: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  ),
  CenterTarget: (props: React.SVGProps<SVGSVGElement>) => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="8" strokeWidth={1.75} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 2v4m0 12v4M2 12h4m12 0h4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
};
