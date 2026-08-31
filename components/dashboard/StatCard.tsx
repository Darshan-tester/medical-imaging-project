"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, LucideIcon } from "lucide-react";
import { KPI } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/hooks";

export type StatTone = "clinical" | "success" | "warning" | "critical";

const TONE_CLASSES: Record<StatTone, { tile: string; ring: string }> = {
  clinical: { tile: "bg-clinical/15 text-clinical", ring: "hover:border-clinical/40" },
  success: { tile: "bg-success/15 text-success", ring: "hover:border-success/40" },
  warning: { tile: "bg-warning/15 text-warning", ring: "hover:border-warning/40" },
  critical: { tile: "bg-critical/15 text-critical", ring: "hover:border-critical/40" },
};

/** Parses "128", "12.4%", "+8" etc. into a numeric target for the count-up; falls back to showing the raw string unanimated. */
function parseNumeric(value: string): number | null {
  const cleaned = value.replace(/[,%+]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function useCountUp(target: number | null, duration = 900) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced || target === null ? target ?? 0 : 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) return;
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const pct = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - pct, 3);
      setValue(from + (target - from) * eased);
      if (pct < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, reduced]);

  return value;
}

export function StatCard({ kpi, icon: Icon, tone = "clinical" }: { kpi: KPI; icon: LucideIcon; tone?: StatTone }) {
  const isGoodDirection = kpi.trend === "flat" ? true : (kpi.trend === "up") === kpi.positiveIsGood;
  const numericTarget = parseNumeric(kpi.value);
  const animated = useCountUp(numericTarget);
  const displayValue = numericTarget === null ? kpi.value : Math.round(animated).toLocaleString();
  const tones = TONE_CLASSES[tone];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-panel p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-clinic",
        tones.ring
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-ink-secondary">{kpi.label}</p>
        <div className={cn("relative flex h-7 w-7 items-center justify-center rounded-md transition-transform duration-200 group-hover:scale-110", tones.tile)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
      </div>
      <p className="mt-3 font-mono text-[28px] font-semibold leading-none tabular-nums text-ink-primary">{displayValue}</p>
      <div className="mt-3 flex items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-0.5 rounded text-[11.5px] font-medium",
            isGoodDirection ? "text-success" : "text-critical"
          )}
        >
          {kpi.trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : kpi.trend === "down" ? <ArrowDownRight className="h-3 w-3" /> : null}
          {kpi.delta}
        </span>
        <span className="text-[11.5px] text-ink-muted">vs yesterday</span>
      </div>
    </div>
  );
}
