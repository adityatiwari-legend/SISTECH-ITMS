"use client";

import React from "react";
import { motion } from "framer-motion";

/** Design-system primitives: states, badges, stats. Labels over color-only. */

export function StatusDot({ color, label, pulse = false }: { color: string; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${pulse ? "itms-pulse" : ""}`}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="font-mono text-[11px] uppercase tracking-wide text-[#8B95A7]">{label}</span>
    </span>
  );
}

export function Badge({ color, children, solid = false }: { color: string; children: React.ReactNode; solid?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
        solid ? "text-[#080B12]" : "border"
      }`}
      style={solid ? { backgroundColor: color } : { borderColor: color, color }}
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
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="itms-panel px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">{label}</div>
      <div className="mt-0.5 font-mono text-lg leading-tight" style={{ color: color ?? "#F4F7FA" }}>
        {value}
      </div>
      {sub !== undefined && <div className="mt-0.5 text-[11px] text-[#8B95A7]">{sub}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[#8B95A7]" role="status">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#202938] border-t-[#38BDF8]" aria-hidden="true" />
      <span className="font-mono text-xs uppercase tracking-wider">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <div className="font-mono text-xs uppercase tracking-wider text-[#8B95A7]">{title}</div>
      {hint !== undefined && <div className="text-[11px] text-[#5c6675]">{hint}</div>}
    </div>
  );
}

export function ErrorState({ title, detail, retry }: { title: string; detail?: string | null; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" role="alert">
      <div className="font-mono text-xs uppercase tracking-wider text-[#EF4444]">⚠ {title}</div>
      {detail !== undefined && detail !== null && <div className="max-w-md text-[11px] text-[#8B95A7]">{detail}</div>}
      {retry !== undefined && (
        <button
          onClick={retry}
          className="mt-1 rounded border border-[#202938] px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-[#8B95A7] hover:border-[#38BDF8] hover:text-[#38BDF8]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function StaleBanner({ label = "Data stale — the simulation is not updating." }: { label?: string }) {
  return (
    <div className="rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 py-1 font-mono text-[11px] text-[#F59E0B]" role="status">
      ◌ {label}
    </div>
  );
}

export function DisconnectedBanner({ detail }: { detail?: string | null }) {
  return (
    <div className="rounded border border-[#EF4444]/40 bg-[#EF4444]/10 px-2.5 py-1 font-mono text-[11px] text-[#EF4444]" role="alert">
      ✕ Backend disconnected. {detail ?? "Reconnecting…"}
    </div>
  );
}

/** Panel with optional title + right-side slot. */
export function Panel({
  title,
  right,
  children,
  className = "",
  emergency = false,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  emergency?: boolean;
}) {
  return (
    <section
      className={`itms-panel overflow-hidden ${className}`}
      style={emergency ? { borderColor: "rgba(255,59,48,0.5)" } : undefined}
    >
      {title !== undefined && (
        <header
          className="flex items-center justify-between border-b px-3 py-2"
          style={{ borderColor: emergency ? "rgba(255,59,48,0.35)" : "#202938" }}
        >
          <h2
            className="font-mono text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: emergency ? "#FF3B30" : "#8B95A7" }}
          >
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function ActionButton({
  children,
  onClick,
  color = "#38BDF8",
  disabled = false,
  type = "button",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor: color, color }}
    >
      {children}
    </motion.button>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#202938]/60 py-1.5 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">{label}</span>
      <span className="font-mono text-[12px] text-[#F4F7FA]">{children}</span>
    </div>
  );
}
