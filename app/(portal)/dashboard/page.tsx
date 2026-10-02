"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { Activity, AlertOctagon, ClipboardList, Sparkles, UploadCloud, Loader2 } from "lucide-react";
import { StatCard, StatTone } from "@/components/dashboard/StatCard";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { PriorityQueue } from "@/components/dashboard/PriorityQueue";
import { VitalsMonitor } from "@/components/dashboard/VitalsMonitor";
import { StudyTable } from "@/components/studies/StudyTable";
import { Button } from "@/components/ui/Button";
import { fetchStudies } from "@/lib/data-source";
import { useAuthStore } from "@/lib/store";
import { Study, KPI, VitalsReading } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/hooks";

const KPI_ICONS = [Activity, Sparkles, ClipboardList, AlertOctagon];
const KPI_TONES: StatTone[] = ["clinical", "success", "warning", "critical"];

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudies()
      .then((data) => {
        if (!cancelled) setStudies(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load studies");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis: KPI[] = useMemo(() => {
    const total = studies.length;
    const aiProcessed = studies.filter(
      (s) => s.status === "ai-complete" || s.status === "in-review" || s.status === "approved"
    ).length;
    const pendingReview = studies.filter(
      (s) => s.status === "ai-complete" || s.status === "in-review" || s.status === "processing"
    ).length;
    const critical = studies.filter(
      (s) => s.priority === "stat" || s.findings.some((f) => f.isCritical)
    ).length;

    return [
      {
        label: "Total Studies",
        value: total.toString(),
        delta: "+12%",
        trend: "up",
        positiveIsGood: true,
      },
      {
        label: "AI Diagnostic Pass",
        value: aiProcessed.toString(),
        delta: `${total > 0 ? Math.round((aiProcessed / total) * 100) : 0}%`,
        trend: "up",
        positiveIsGood: true,
      },
      {
        label: "Pending Review",
        value: pendingReview.toString(),
        delta: pendingReview > 5 ? "+4" : "Normal",
        trend: pendingReview > 5 ? "up" : "flat",
        positiveIsGood: false,
      },
      {
        label: "Critical / STAT",
        value: critical.toString(),
        delta: critical > 0 ? "Immediate" : "0",
        trend: critical > 0 ? "up" : "flat",
        positiveIsGood: false,
      },
    ];
  }, [studies]);

  const activeVitalsStudy = useMemo(() => {
    return (
      studies.find((s) => s.priority === "stat" && s.status !== "approved") ||
      studies.find((s) => s.status === "in-review" || s.status === "processing") ||
      studies[0]
    );
  }, [studies]);

  const liveVitals: VitalsReading | null = useMemo(() => {
    if (!activeVitalsStudy) return null;
    const isStat = activeVitalsStudy.priority === "stat";
    return {
      studyRouteId: activeVitalsStudy.id,
      studyCode: activeVitalsStudy.studyId,
      patientAlias: activeVitalsStudy.patientAlias,
      modality: activeVitalsStudy.modality,
      bodyRegion: activeVitalsStudy.bodyRegion || "Corpus",
      bpm: isStat ? 112 : 74,
      restingBpm: 70,
      status: isStat ? "elevated" : "normal",
      updatedSecondsAgo: 3,
      stats: [
        { label: "Modality", value: activeVitalsStudy.modality, unit: "" },
        { label: "Series", value: String(activeVitalsStudy.series?.length || 1), unit: "stk" },
        { label: "Slices", value: String(activeVitalsStudy.series?.[0]?.sliceCount || 1), unit: "img" },
        { label: "AI Conf", value: `${activeVitalsStudy.aiConfidence ?? 94}%`, unit: "" },
      ],
    };
  }, [activeVitalsStudy]);

  const recent = useMemo(() => studies.slice(0, 6), [studies]);

  if (loading && studies.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-clinical" />
        <p className="text-[13px] text-ink-muted">Loading radiology workspace telemetry…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-clinical">{today}</p>
          <h1 className="mt-1 text-page-title text-ink-primary">Good morning, {user?.name || "Doctor"}</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-secondary">
            {kpis[2].value} studies pending review · {kpis[3].value} flagged as critical priority
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/upload">
            <Button variant="primary" size="md">
              <UploadCloud className="h-4 w-4" /> Upload Scan
            </Button>
          </Link>
          <Link href="/studies">
            <Button variant="secondary" size="md">
              View Worklist
            </Button>
          </Link>
        </div>
      </div>

      <motion.div
        variants={reduced ? undefined : gridVariants}
        initial={reduced ? undefined : "hidden"}
        animate={reduced ? undefined : "show"}
        className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} variants={reduced ? undefined : cardVariants}>
            <StatCard kpi={kpi} icon={KPI_ICONS[i]} tone={KPI_TONES[i]} />
          </motion.div>
        ))}
      </motion.div>

      {liveVitals && (
        <div className="mt-6">
          <VitalsMonitor reading={liveVitals} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <DashboardHero />
        <PriorityQueue studies={studies} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-card-title text-ink-primary">Recent Studies</h3>
            <p className="mt-0.5 text-[11.5px] text-ink-secondary">Latest indexed patient cases in active worklist</p>
          </div>
          <Link href="/studies" className="text-[12.5px] font-medium text-clinical hover:text-clinical-strong">
            View full worklist →
          </Link>
        </div>
        <StudyTable studies={recent} compact />
      </div>
    </div>
  );
}

