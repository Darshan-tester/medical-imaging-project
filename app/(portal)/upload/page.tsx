"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, UploadCloud } from "lucide-react";

import { UploadZone, UploadDetails } from "@/components/upload/UploadZone";
import { ProcessingTimeline } from "@/components/upload/ProcessingTimeline";
import { MatchResults } from "@/components/upload/MatchResults";
import { Button } from "@/components/ui/Button";
import { ModalityBadge, ConfidenceBand } from "@/components/ui/Badge";
import { getDataMode, matchUploads, type UploadMatchResult } from "@/lib/data-source";
import { createDemoStudy } from "@/lib/mock-data";
import { Study } from "@/lib/types";

/**
 * Two upload paths, chosen by data mode and never mixed:
 *
 * - mock: the original seeded demo. `createDemoStudy` invents a study from the
 *   typed modality/region and pushes it into the in-memory list, which is why
 *   its "Open Study" link only resolves while the app is running on mock data.
 * - dataset: the file itself is hashed and looked up in the index, and the
 *   result is the study it actually came from. Nothing is scored, predicted or
 *   drafted here, so this branch shows no confidence band and no finding count.
 */
type Phase =
  | { kind: "form" }
  | { kind: "analyzing"; files: File[]; details: UploadDetails }
  | { kind: "analyzed"; study: Study }
  | { kind: "matching" }
  | { kind: "matched"; results: UploadMatchResult[] }
  | { kind: "error"; message: string };

export default function UploadPage() {
  // `NEXT_PUBLIC_DATA_MODE` is inlined at build time, so this is constant for
  // the life of the page and identical on server and client.
  const dataMode = getDataMode();
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const onStart = async (files: File[], details: UploadDetails) => {
    if (dataMode !== "dataset") {
      setPhase({ kind: "analyzing", files, details });
      return;
    }
    setPhase({ kind: "matching" });
    try {
      setPhase({ kind: "matched", results: await matchUploads(files) });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Upload matching failed" });
    }
  };

  const onAnalyzed = () => {
    if (phase.kind !== "analyzing") return;
    // Turn the real files the user dropped in into displayable image URLs so
    // the viewer shows the actual scan instead of a placeholder. Only image/*
    // files can be rendered directly in the browser (raw DICOM etc. can't) —
    // those are still counted as slices but fall back to the synthetic texture
    // in the viewer.
    const imageUrls = phase.files.filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f));
    setPhase({
      kind: "analyzed",
      study: createDemoStudy({
        patientAlias: phase.details.patientAlias,
        modality: phase.details.modality,
        bodyRegion: phase.details.bodyRegion,
        priority: phase.details.priority,
        fileCount: phase.files.length,
        imageUrls,
        // Demographics as typed. Anything the person left blank stays
        // `undefined` here and is filled — and badged — by
        // `buildPatientProfile`, so a blank box never turns into a number
        // that reads as if it were entered.
        age: phase.details.age,
        sex: phase.details.sex,
        heightCm: phase.details.heightCm,
        weightKg: phase.details.weightKg,
        history: phase.details.history,
        notes: phase.details.notes,
      }),
    });
  };

  const reset = () => setPhase({ kind: "form" });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <UploadCloud className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-section-title text-ink-primary">Upload Scan</h1>
          <p className="text-[12.5px] text-ink-secondary">
            {dataMode === "dataset"
              ? "Match a scan file back to the indexed study it came from."
              : "Add a single image or a full CT/MRI series for AI-assisted analysis."}
          </p>
        </div>
      </div>

      {phase.kind === "form" && <UploadZone onStart={onStart} mode={dataMode === "dataset" ? "match" : "analyze"} />}
      {phase.kind === "analyzing" && <ProcessingTimeline onComplete={onAnalyzed} />}
      {phase.kind === "matching" && <MatchingPanel />}
      {phase.kind === "matched" && <MatchResults results={phase.results} onReset={reset} />}
      {phase.kind === "error" && <ErrorPanel message={phase.message} onReset={reset} />}
      {phase.kind === "analyzed" && <AnalyzedCard study={phase.study} onReset={reset} />}
    </div>
  );
}

/**
 * Hashing is fast enough that this is usually a flash, so it stays a single
 * honest line rather than a staged timeline — there are no AI stages to show.
 */
function MatchingPanel() {
  return (
    <div className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-clinical" />
        <div>
          <h3 className="text-card-title text-ink-primary">Hashing files and searching the index</h3>
          <p className="mt-1 text-[12.5px] text-ink-secondary">Files are hashed in memory on this machine and never written to disk.</p>
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="rounded-xl border border-critical/30 bg-panel p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
        <div className="min-w-0 flex-1">
          <h3 className="text-card-title text-ink-primary">Could not match these files</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">{message}</p>
          <Button variant="secondary" size="md" className="mt-4" onClick={onReset}>
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Mock-mode result card, unchanged from the seeded demo: the confidence band and
 * finding count below come from `createDemoStudy`'s seeded generator, which only
 * exists on mock data. It is never rendered in dataset mode.
 */
function AnalyzedCard({ study, onReset }: { study: Study; onReset: () => void }) {
  return (
    <div className="rounded-xl border border-success/30 bg-panel p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-dim text-success">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-ink-primary">Analysis complete</h3>
      <p className="mt-1.5 text-[13px] text-ink-secondary">
        {study.studyId} · {study.patientAlias}
      </p>

      <div className="mt-4 flex items-center justify-center gap-2">
        <ModalityBadge modality={study.modality} />
        {study.aiConfidence !== null && (
          <ConfidenceBand band={study.aiConfidence >= 88 ? "high" : study.aiConfidence >= 70 ? "moderate" : "low"} />
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[12.5px] text-ink-secondary">
        <Sparkles className="h-3.5 w-3.5 text-ai" />
        {study.findings.length} finding{study.findings.length !== 1 ? "s" : ""} flagged for radiologist review
      </div>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        <Link href={`/studies/${study.id}`}>
          <Button variant="primary" size="md" className="w-full sm:w-auto">
            Open Study
          </Button>
        </Link>
        <Button variant="secondary" size="md" onClick={onReset}>
          Upload Another
        </Button>
      </div>
    </div>
  );
}
