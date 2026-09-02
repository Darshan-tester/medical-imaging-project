"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ScanEye } from "lucide-react";
import { Study } from "@/lib/types";
import { DatasetSourceBadge, ModalityBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { ConfidenceIndicator } from "@/components/ui/ConfidenceIndicator";
import { ScanThumbnail } from "./ScanThumbnail";
import { formatDate } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/hooks";

export function StudyCard({ study }: { study: Study }) {
  const reduced = usePrefersReducedMotion();
  const router = useRouter();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 22 });
  const springY = useSpring(y, { stiffness: 200, damping: 22 });
  const previewX = useTransform(springX, [-0.5, 0.5], [-6, 6]);
  const previewY = useTransform(springY, [-0.5, 0.5], [-6, 6]);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <Link href={`/studies/${study.id}`}>
      <motion.div
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        whileHover={reduced ? undefined : { y: -3 }}
        transition={{ duration: 0.2 }}
        className="group overflow-hidden rounded-xl border border-border bg-panel transition-colors duration-150 hover:border-border-strong"
      >
        <div className="relative h-32 overflow-hidden bg-base">
          <motion.div style={reduced ? undefined : { x: previewX, y: previewY, scale: 1.12 }} className="h-full w-full">
            {/* Lazy: the grid now shows real indexed cover images, so an
                un-gated 60-card page would fire 60 server renders on mount. */}
            <ScanThumbnail
              seed={study.thumbnailSeed}
              modality={study.modality}
              imageUrl={study.imageUrls?.[0]}
              animated
              loading="lazy"
              className="h-full w-full"
            />
          </motion.div>
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            <ModalityBadge modality={study.modality} />
            {study.datasetSource && <DatasetSourceBadge source={study.datasetSource} />}
          </div>
          <div className="absolute right-3 top-3">
            <PriorityBadge priority={study.priority} />
          </div>
          {study.findings.length > 0 && (
            <div className="absolute bottom-3 left-3 rounded-md border border-border-strong bg-base/80 px-2 py-0.5 text-[10.5px] font-medium text-ink-secondary backdrop-blur">
              {study.findings.length} finding{study.findings.length > 1 ? "s" : ""}
            </div>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/studies/${study.id}?tab=analysis`);
            }}
            className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border-strong bg-base/80 px-2 py-1 text-[10.5px] font-medium text-ink-primary backdrop-blur transition-opacity duration-150 hover:border-clinical/50 hover:text-clinical sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={`View scan for ${study.studyId}`}
          >
            <ScanEye className="h-3 w-3" /> View Scan
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink-primary">{study.patientAlias}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                {[study.studyId, study.bodyRegion].filter(Boolean).join(" · ")}
              </p>
            </div>
            <StatusBadge status={study.status} />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-[11px] text-ink-muted tabular-nums">{study.date ? formatDate(study.date) : "Date not available"}</span>
            {study.aiConfidence !== null ? (
              <ConfidenceIndicator
                value={study.aiConfidence}
                band={study.aiConfidence >= 88 ? "high" : study.aiConfidence >= 70 ? "moderate" : "low"}
                size="sm"
              />
            ) : (
              <span className="text-[11px] text-ink-muted">
                {study.aiStatus === "not-run" ? "No AI analysis" : study.aiStatus === "simulated" ? "Simulated AI" : "Pending AI"}
              </span>

            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
