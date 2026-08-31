"use client";

import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";
import Link from "next/link";
import { VitalDot } from "@/components/ui/MedicalMotifs";

const MedicalScene = dynamic(() => import("@/components/three/MedicalScene").then((m) => m.MedicalScene), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-[#0F172A]" />,
});

export function DashboardHero() {
  return (
    <div className="relative h-[380px] overflow-hidden rounded-xl border border-border bg-[#0A0F1C]">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: "radial-gradient(circle at 70% 15%, rgba(59,130,246,0.18), transparent 55%)" }}
      />
      {/* Slow monitor scan-line sweep — reinforces the "live monitor" feel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 overflow-hidden opacity-40">
        <div className="h-full w-full animate-monitor-scan bg-gradient-to-b from-clinical/25 via-clinical/5 to-transparent" />
      </div>
      <div className="absolute inset-0">
        <MedicalScene />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <VitalDot tone="clinical" size="sm" /> Live Workspace Overview
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-white">Active Study Volume</h3>
        </div>
        <Link
          href="/studies"
          className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-300 backdrop-blur transition-colors hover:text-white"
        >
          <Maximize2 className="h-3 w-3" /> View all studies
        </Link>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#0A0F1C] to-transparent p-5 pt-10">
        <div className="flex items-center gap-4 text-[11.5px] text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#60A5FA]" /> AI detection points
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE]" /> Scan volume
          </span>
        </div>
        <p className="text-[11px] text-slate-500">Ambient visualization · not diagnostic</p>
      </div>
    </div>
  );
}
