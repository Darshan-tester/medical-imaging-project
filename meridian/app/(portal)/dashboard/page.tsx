"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, AlertOctagon, ClipboardList, Sparkles, UploadCloud } from "lucide-react";
import { StatCard, StatTone } from "@/components/dashboard/StatCard";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { PriorityQueue } from "@/components/dashboard/PriorityQueue";
import { VitalsMonitor } from "@/components/dashboard/VitalsMonitor";
import { StudyTable } from "@/components/studies/StudyTable";
import { Button } from "@/components/ui/Button";
import { getKPIs, listStudies, getLiveVitals, CURRENT_USER } from "@/lib/mock-data";
import { usePrefersReducedMotion } from "@/lib/hooks";

const KPI_ICONS = [Activity, Sparkles, ClipboardList, AlertOctagon];
// Blue for volume, green for AI throughput, amber/orange for what needs your
// attention, red for what's critical — the palette carries real meaning here.
const KPI_TONES: StatTone[] = ["clinical", "success", "warning", "critical"];

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function DashboardPage() {
  const kpis = getKPIs();
  const vitals = getLiveVitals();
  const studies = listStudies();
  const recent = studies.slice(0, 6);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const reduced = usePrefersReducedMotion();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-clinical">{today}</p>
          <h1 className="mt-1 text-page-title text-ink-primary">Good morning, {CURRENT_USER.name.replace("Dr. ", "Dr. ")}</h1>
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
              View Studies
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

      <div className="mt-6">
        <VitalsMonitor reading={vitals} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <DashboardHero />
        <PriorityQueue studies={studies} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-card-title text-ink-primary">Recent Studies</h3>
            <p className="mt-0.5 text-[11.5px] text-ink-secondary">Latest activity across your workspace</p>
          </div>
          <Link href="/studies" className="text-[12.5px] font-medium text-clinical hover:text-clinical-strong">
            View all →
          </Link>
        </div>
        <StudyTable studies={recent} compact />
      </div>
    </div>
  );
}

