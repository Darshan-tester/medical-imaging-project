"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Sparkles, UploadCloud } from "lucide-react";
import { UploadZone, UploadDetails } from "@/components/upload/UploadZone";
import { ProcessingTimeline } from "@/components/upload/ProcessingTimeline";
import { Button } from "@/components/ui/Button";
import { ModalityBadge, ConfidenceBand } from "@/components/ui/Badge";
import { createDemoStudy } from "@/lib/mock-data";
import { Study } from "@/lib/types";

type Stage = "form" | "processing" | "complete";

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>("form");
  const [pending, setPending] = useState<{ files: File[]; details: UploadDetails } | null>(null);
  const [createdStudy, setCreatedStudy] = useState<Study | null>(null);

  const onStart = (files: File[], details: UploadDetails) => {
    setPending({ files, details });
    setStage("processing");
  };

  const onComplete = () => {
    if (!pending) return;
    // Turn the real files the user dropped in into displayable image URLs so
    // the viewer shows the actual scan instead of a placeholder. Only
    // image/* files can be rendered directly in the browser (raw DICOM etc.
    // can't) — those are still counted as slices but fall back to the
    // synthetic texture in the viewer.
    const imageUrls = pending.files.filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f));
    const study = createDemoStudy({
      patientAlias: pending.details.patientAlias,
      modality: pending.details.modality,
      bodyRegion: pending.details.bodyRegion,
      priority: pending.details.priority,
      fileCount: pending.files.length,
      imageUrls,
    });
    setCreatedStudy(study);
    setStage("complete");
  };

  const reset = () => {
    setPending(null);
    setCreatedStudy(null);
    setStage("form");
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <UploadCloud className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-section-title text-ink-primary">Upload Scan</h1>
          <p className="text-[12.5px] text-ink-secondary">Add a single image or a full CT/MRI series for AI-assisted analysis.</p>
        </div>
      </div>

      {stage === "form" && <UploadZone onStart={onStart} />}
      {stage === "processing" && <ProcessingTimeline onComplete={onComplete} />}

      {stage === "complete" && createdStudy && (
        <div className="rounded-xl border border-success/30 bg-panel p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-dim text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-[16px] font-semibold text-ink-primary">Analysis complete</h3>
          <p className="mt-1.5 text-[13px] text-ink-secondary">
            {createdStudy.studyId} · {createdStudy.patientAlias}
          </p>

          <div className="mt-4 flex items-center justify-center gap-2">
            <ModalityBadge modality={createdStudy.modality} />
            {createdStudy.aiConfidence !== null && (
              <ConfidenceBand band={createdStudy.aiConfidence >= 88 ? "high" : createdStudy.aiConfidence >= 70 ? "moderate" : "low"} />
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[12.5px] text-ink-secondary">
            <Sparkles className="h-3.5 w-3.5 text-ai" />
            {createdStudy.findings.length} finding{createdStudy.findings.length !== 1 ? "s" : ""} flagged for radiologist review
          </div>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link href={`/studies/${createdStudy.id}`}>
              <Button variant="primary" size="md" className="w-full sm:w-auto">
                Open Study
              </Button>
            </Link>
            <Button variant="secondary" size="md" onClick={reset}>
              Upload Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
