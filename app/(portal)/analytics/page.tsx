"use client";

import { BarChart3 } from "lucide-react";
import { listStudies } from "@/lib/mock-data";
import { BarChart } from "@/components/analytics/BarChart";
import { DonutChart } from "@/components/analytics/DonutChart";
import { Modality } from "@/lib/types";

export default function AnalyticsPage() {
  const studies = listStudies();

  const days = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return d;
  });
  const studiesByDay = days.map((d) => ({
    label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
    value: studies.filter((s) => s.date && new Date(s.date).toDateString() === d.toDateString()).length,
  }));

  const modalities: Modality[] = ["CT", "MRI", "X-Ray", "Ultrasound", "PET", "Mammography"];
  const modalityData = modalities.map((m) => ({ label: m, value: studies.filter((s) => s.modality === m).length })).filter((d) => d.value > 0);

  const confidenceBuckets = ["high", "moderate", "low"] as const;
  const confidenceData = confidenceBuckets.map((band) => ({
    label: band,
    value: studies.filter((s) => {
      if (s.aiConfidence === null) return false;
      const b = s.aiConfidence >= 88 ? "high" : s.aiConfidence >= 70 ? "moderate" : "low";
      return b === band;
    }).length,
  }));

  const reportStatuses = ["ai-draft", "in-review", "approved"] as const;
  const reportData = reportStatuses.map((s) => ({ label: s.replace("-", " "), value: studies.filter((st) => st.report.status === s).length }));

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8 md:py-8">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <BarChart3 className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-section-title text-ink-primary">Analytics</h1>
          <p className="text-[12.5px] text-ink-secondary">Workspace throughput and AI performance at a glance.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">Studies — Last 14 Days</h3>
          <div className="mt-4">
            <BarChart data={studiesByDay} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">Modality Breakdown</h3>
          <div className="mt-4">
            <DonutChart data={modalityData} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">AI Confidence Distribution</h3>
          <p className="mt-1 text-[11.5px] text-ink-secondary">Share of studies by overall AI confidence band</p>
          <div className="mt-4">
            <BarChart data={confidenceData} color="#3B82F6" colors={["#22C55E", "#F59E0B", "#EF4444"]} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">Report Pipeline</h3>
          <p className="mt-1 text-[11.5px] text-ink-secondary">Reports by current review stage</p>
          <div className="mt-4">
            <BarChart data={reportData} color="#22C55E" colors={["#3B82F6", "#F59E0B", "#22C55E"]} />
          </div>
        </div>
      </div>

      <p className="mt-6 text-[11px] text-ink-muted">Figures reflect this demo workspace&apos;s synthetic dataset, not real clinical throughput.</p>
    </div>
  );
}
