"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, Heart } from "lucide-react";
import { PulseTrace } from "./PulseTrace";
import { Badge } from "@/components/ui/Badge";
import { VitalDot } from "@/components/ui/MedicalMotifs";
import { usePrefersReducedMotion } from "@/lib/hooks";
import type { VitalsReading, VitalsStatus } from "@/lib/types";

const STATUS_LABEL: Record<VitalsStatus, string> = {
  normal: "Normal sinus rhythm",
  elevated: "Elevated",
  critical: "Critical",
};

const STATUS_TONE: Record<VitalsStatus, "success" | "warning" | "critical"> = {
  normal: "success",
  elevated: "warning",
  critical: "critical",
};

const ICON_TILE: Record<VitalsStatus, string> = {
  normal: "border-success/30 bg-success-dim",
  elevated: "border-warning/30 bg-warning-dim",
  critical: "border-critical/30 bg-critical-dim",
};

const GLOW_VAR: Record<VitalsStatus, string> = {
  normal: "--color-success",
  elevated: "--color-warning",
  critical: "--color-critical",
};

export function VitalsMonitor({ reading }: { reading: VitalsReading }) {
  const reduced = usePrefersReducedMotion();
  const tone = STATUS_TONE[reading.status];
  const beatDuration = 60 / reading.bpm;
  const delta = reading.bpm - reading.restingBpm;

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-card-title text-ink-primary">
            <VitalDot tone={tone} size="sm" />
            Live Patient Vitals
          </h3>
          <p className="mt-0.5 text-[11.5px] text-ink-secondary">
            {reading.patientAlias} · {reading.studyCode} · {reading.modality} {reading.bodyRegion}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge tone={tone}>{STATUS_LABEL[reading.status]}</Badge>
          <Link
            href={`/studies/${reading.studyRouteId}`}
            className="text-[12.5px] font-medium text-clinical hover:text-clinical-strong"
          >
            View study →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-8">
        <div className="flex items-center gap-4">
          <motion.span
            className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${ICON_TILE[reading.status]}`}
            animate={reduced ? { scale: 1 } : { scale: [1, 1.08, 1, 1.04, 1] }}
            transition={{ duration: beatDuration, repeat: Infinity, ease: "easeInOut" }}
            style={{ filter: `drop-shadow(0 0 14px rgb(var(${GLOW_VAR[reading.status]}) / 0.35))` }}
          >
            <Heart className="h-6 w-6 text-critical" fill="currentColor" aria-hidden="true" />
          </motion.span>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-4xl font-semibold tabular-nums leading-none text-ink-primary">
                {reading.bpm}
              </span>
              <span className="font-mono text-xs text-ink-muted">bpm</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-ink-secondary">
              <Activity className="h-3 w-3 text-critical" aria-hidden="true" />
              +{delta} vs resting {reading.restingBpm}
            </p>
          </div>
        </div>

        <div className="h-24 min-w-0">
          <PulseTrace bpm={reading.bpm} />
        </div>

        <dl className="grid grid-cols-4 gap-4 border-t border-border pt-4 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-2.5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          {reading.stats.map((stat) => (
            <div key={stat.label}>
              <dt className="font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">{stat.label}</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-ink-primary">
                {stat.value}
                <span className="ml-1 font-mono text-[10.5px] font-normal text-ink-muted">{stat.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-border px-5 py-2 font-mono text-[10.5px] text-ink-muted">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-critical" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-critical" />
        </span>
        Live · updated {reading.updatedSecondsAgo}s ago
      </div>
    </div>
  );
}
