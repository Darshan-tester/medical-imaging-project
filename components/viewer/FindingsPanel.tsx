"use client";

import { motion } from "framer-motion";
import { Sparkles, Pencil } from "lucide-react";
import { Finding, RadiologistFinding, SeriesInfo } from "@/lib/types";
import { FindingCard } from "./FindingCard";
import { RadiologistFindingCard } from "./RadiologistFindingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Loader2 } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/hooks";

function locationFor(series: SeriesInfo[] | undefined, seriesId: string | undefined, sliceIndex: number): string | undefined {
  if (!series) return undefined;
  if (series.length > 1) {
    return `${series.find((s) => s.id === seriesId)?.label ?? series[0].label} · Slice ${sliceIndex + 1}`;
  }
  return series[0] && series[0].sliceCount > 1 ? `Slice ${sliceIndex + 1}` : undefined;
}

export function FindingsPanel({
  findings,
  activeFindingId,
  onHover,
  onSelect,
  onUpdate,
  isProcessing,
  series,
  radiologistFindings = [],
  onSelectRadiologistFinding,
  onEditRadiologistFinding,
  onDeleteRadiologistFinding,
  onAddRadiologistFindingToReport,
  mode = "both",
  aiStatus = "complete",
}: {
  findings: Finding[];
  activeFindingId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Finding>) => void;
  isProcessing: boolean;
  /** Optional — when provided, each card shows which series/slice it lives on. */
  series?: SeriesInfo[];
  /** Radiologist-authored findings, drawn from pen annotations. Clearly distinguished from AI findings. */
  radiologistFindings?: RadiologistFinding[];
  onSelectRadiologistFinding?: (id: string) => void;
  onEditRadiologistFinding?: (id: string) => void;
  onDeleteRadiologistFinding?: (id: string) => void;
  onAddRadiologistFindingToReport?: (id: string) => void;
  /** "ai" = AI Findings tab only. "radiologist" = Annotations tab's finding list only. "both" (default) = original combined layout used by the mobile drawer. */
  mode?: "ai" | "radiologist" | "both";
  /**
   * "not-run" shows "AI analysis not available for this study." instead of the
   * generic empty state — an untouched study is not the same as a clear result.
   *
   * "simulated" means the findings listed below were placed by
   * `lib/simulated-findings.ts`: their text is quoted from this study's own
   * report, their boxes and confidences are inferred from that text and not
   * from the pixels. The banner saying so is not optional.
   */
  aiStatus?: "not-run" | "complete" | "simulated";
}) {
  const reduced = usePrefersReducedMotion();
  const hasRadiologistFindings = radiologistFindings.length > 0;
  const showAiSection = mode === "ai" || mode === "both";
  const showRadiologistSection = mode === "radiologist" || mode === "both";

  return (
    <div className="flex h-full flex-col">
      {showAiSection && (
        <>
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-ai" />
              <h3 className="text-[13px] font-semibold text-ink-primary">AI Findings</h3>
            </div>
            <span className="rounded-md bg-clinical/12 px-1.5 py-0.5 font-mono text-[11px] font-medium text-clinical">{findings.length}</span>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {aiStatus === "simulated" && findings.length > 0 && !isProcessing ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] leading-snug text-warning-strong">
                <span className="font-semibold uppercase tracking-wide">Simulated</span> — no AI model has run on this study. Each item below quotes a
                sentence from the study&apos;s own radiology report; the box and the confidence are inferred from that wording, not measured from the
                image.
              </p>
            ) : null}
            {isProcessing ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-ai" />
                <p className="text-[12.5px] text-ink-secondary">AI analysis in progress…</p>
              </div>
            ) : findings.length === 0 && aiStatus === "not-run" ? (
              <EmptyState icon={Sparkles} title="AI analysis not available for this study." description="No AI model has produced results for this study yet." />
            ) : findings.length === 0 ? (
              <EmptyState icon={Sparkles} title="No AI findings yet" description="This study hasn't completed AI analysis, or no findings were flagged." />
            ) : (
              findings.map((f, i) => (
                <motion.div
                  key={f.id}
                  initial={reduced ? undefined : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: reduced ? 0 : i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                >
                  <FindingCard
                    index={i}
                    finding={f}
                    isActive={f.id === activeFindingId}
                    onHover={onHover}
                    onSelect={onSelect}
                    onUpdate={onUpdate}
                    locationLabel={locationFor(series, f.seriesId, f.sliceIndex)}
                  />
                </motion.div>
              ))
            )}

            {mode === "both" && !isProcessing && (
              <div className={cnHeaderTop(hasRadiologistFindings)}>
                <RadiologistFindingsSection
                  radiologistFindings={radiologistFindings}
                  activeFindingId={activeFindingId}
                  onHover={onHover}
                  onSelectRadiologistFinding={onSelectRadiologistFinding}
                  onEditRadiologistFinding={onEditRadiologistFinding}
                  onDeleteRadiologistFinding={onDeleteRadiologistFinding}
                  onAddRadiologistFindingToReport={onAddRadiologistFindingToReport}
                  series={series}
                  reduced={reduced}
                />
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3">
            <p className="text-[10.5px] leading-relaxed text-ink-muted">
              AI findings are decision support only. Confidence reflects model certainty, not diagnostic certainty — always correlate clinically.
            </p>
          </div>
        </>
      )}

      {showRadiologistSection && mode !== "both" && (
        <div className="flex-1 overflow-y-auto p-3">
          <RadiologistFindingsSection
            radiologistFindings={radiologistFindings}
            activeFindingId={activeFindingId}
            onHover={onHover}
            onSelectRadiologistFinding={onSelectRadiologistFinding}
            onEditRadiologistFinding={onEditRadiologistFinding}
            onDeleteRadiologistFinding={onDeleteRadiologistFinding}
            onAddRadiologistFindingToReport={onAddRadiologistFindingToReport}
            series={series}
            reduced={reduced}
          />
        </div>
      )}
    </div>
  );
}

function RadiologistFindingsSection({
  radiologistFindings,
  activeFindingId,
  onHover,
  onSelectRadiologistFinding,
  onEditRadiologistFinding,
  onDeleteRadiologistFinding,
  onAddRadiologistFindingToReport,
  series,
  reduced,
}: {
  radiologistFindings: RadiologistFinding[];
  activeFindingId: string | null;
  onHover: (id: string | null) => void;
  onSelectRadiologistFinding?: (id: string) => void;
  onEditRadiologistFinding?: (id: string) => void;
  onDeleteRadiologistFinding?: (id: string) => void;
  onAddRadiologistFindingToReport?: (id: string) => void;
  series?: SeriesInfo[];
  reduced: boolean;
}) {
  const hasRadiologistFindings = radiologistFindings.length > 0;
  return (
    <>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <Pencil className="h-3.5 w-3.5 text-secondary-strong" />
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">Radiologist Findings</h4>
        {hasRadiologistFindings && (
          <span className="rounded-md bg-secondary/15 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-secondary-strong">
            {radiologistFindings.length}
          </span>
        )}
      </div>

      {hasRadiologistFindings ? (
        <div className="space-y-2.5">
          {radiologistFindings.map((f, i) => (
            <motion.div
              key={f.id}
              initial={reduced ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: reduced ? 0 : i * 0.05, ease: [0.16, 1, 0.3, 1] }}
            >
              <RadiologistFindingCard
                finding={f}
                isActive={f.id === activeFindingId}
                onHover={onHover}
                onSelect={onSelectRadiologistFinding ?? (() => {})}
                onEdit={onEditRadiologistFinding ?? (() => {})}
                onDelete={onDeleteRadiologistFinding ?? (() => {})}
                onAddToReport={onAddRadiologistFindingToReport ?? (() => {})}
                locationLabel={locationFor(series, f.seriesId, f.sliceIndex)}
              />
            </motion.div>
          ))}
        </div>
      ) : (
        <p className="px-1 text-[11.5px] leading-relaxed text-ink-muted">
          Select the Pen tool, draw around a region, then choose &quot;Add Finding&quot; to write your own observation here.
        </p>
      )}
    </>
  );
}

function cnHeaderTop(hasFindings: boolean): string {
  return hasFindings ? "mt-4 border-t border-border pt-4" : "mt-4 border-t border-dashed border-border pt-4";
}

