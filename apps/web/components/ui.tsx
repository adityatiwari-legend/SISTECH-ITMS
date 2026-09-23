"use client";

import React from "react";
import { motion } from "framer-motion";

/** Premium SaaS primitives: layered cards, glow accents, labeled states. */

export function StatusDot({ color, label, pulse = false }: { color: string; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
          aria-hidden="true"
        />
        {pulse && <span className="itms-pulse absolute inset-0 rounded-full" aria-hidden="true" />}
      </span>
      {label !== "" && <span className="font-mono text-[11px] uppercase tracking-wide text-[#8B95A9]">{label}</span>}
    </span>
  );
}

export function Badge({ color, children, solid = false }: { color: string; children: React.ReactNode; solid?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
        solid ? "text-[#05060a]" : "border"
      }`}
      style={
        solid
          ? { backgroundColor: color, boxShadow: `0 0 14px ${color}55` }
          : { borderColor: `${color}66`, color, background: `${color}14` }
      }
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  color,
  accent = "info",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  accent?: "info" | "ai" | "success" | "warning" | "critical" | "emergency";
}) {
  const ACCENTS: Record<string, string> = {
    info: "#67e8f9",
    ai: "#a78bfa",
    success: "#34d399",
    warning: "#fbbf24",
    critical: "#f87171",
    emergency: "#ff453a",
  };
  const accentColor = color ?? ACCENTS[accent] ?? ACCENTS.info;
  return (
    <div className="itms-panel itms-hover px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }} aria-hidden="true" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A9]">{label}</div>
      </div>
      <div className="mt-1.5 font-mono text-xl leading-tight tracking-tight" style={{ color: color ?? "#EEF2F9" }}>
        {value}
      </div>
      {sub !== undefined && <div className="mt-1 text-[11px] text-[#6B7385]">{sub}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-[#8B95A9]" role="status">
      <span className="relative inline-block h-3.5 w-3.5">
        <span className="inline-block h-full w-full animate-spin rounded-full border-2 border-[rgba(148,163,190,0.15)] border-t-[#67e8f9]" aria-hidden="true" />
      </span>
      <span className="font-mono text-xs uppercase tracking-wider">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,190,0.14)] bg-[rgba(148,163,190,0.06)] text-[#8B95A9]" aria-hidden="true">
        ◌
      </div>
      <div className="font-mono text-xs uppercase tracking-wider text-[#8B95A9]">{title}</div>
      {hint !== undefined && <div className="max-w-sm text-[11px] leading-relaxed text-[#6B7385]">{hint}</div>}
    </div>
  );
}

export function ErrorState({ title, detail, retry }: { title: string; detail?: string | null; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center" role="alert">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.1)] text-[#f87171]" aria-hidden="true">
        !
      </div>
      <div className="font-mono text-xs uppercase tracking-wider text-[#f87171]">{title}</div>
      {detail !== undefined && detail !== null && <div className="max-w-md text-[11px] leading-relaxed text-[#8B95A9]">{detail}</div>}
      {retry !== undefined && (
        <button
          onClick={retry}
          className="mt-1 rounded-lg border border-[rgba(148,163,190,0.2)] bg-[rgba(148,163,190,0.06)] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#8B95A9] transition-colors hover:border-[#67e8f9] hover:text-[#67e8f9]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function StaleBanner({ label = "Data stale — the simulation is not updating." }: { label?: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#fbbf24]"
      role="status"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#fbbf24]" aria-hidden="true" />
      {label}
    </div>
  );
}

export function DisconnectedBanner({ detail }: { detail?: string | null }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#f87171]"
      role="alert"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f87171]" aria-hidden="true" />
      Backend disconnected. {detail ?? "Reconnecting…"}
    </div>
  );
}

/** Panel with gradient title bar + right-side slot. */
export function Panel({
  title,
  right,
  children,
  className = "",
  emergency = false,
  ai = false,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  emergency?: boolean;
  ai?: boolean;
}) {
  const titleColor = emergency ? "#ff453a" : ai ? "#a78bfa" : "#8B95A9";
  const borderColor = emergency ? "rgba(255,69,58,0.42)" : ai ? "rgba(167,139,250,0.36)" : undefined;
  return (
    <section className={`itms-panel overflow-hidden ${className}`} style={borderColor !== undefined ? { borderColor } : undefined}>
      {title !== undefined && (
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: emergency || ai ? borderColor : "rgba(148,163,190,0.1)" }}
        >
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: titleColor }}>
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ActionButton({
  children,
  onClick,
  color = "#67e8f9",
  disabled = false,
  type = "button",
  title,
  filled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  filled?: boolean;
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.965 }}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-40"
      style={
        filled
          ? { backgroundColor: color, borderColor: color, color: "#05060a", boxShadow: `0 0 18px ${color}44` }
          : { borderColor: `${color}66`, color, background: `${color}12` }
      }
    >
      {children}
    </motion.button>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[rgba(148,163,190,0.08)] py-2 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A9]">{label}</span>
      <span className="font-mono text-[12px] text-[#EEF2F9]">{children}</span>
    </div>
  );
}

/** Page hero header: gradient title + subtitle + right slot. */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-[11px] text-[#6B7385]">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
