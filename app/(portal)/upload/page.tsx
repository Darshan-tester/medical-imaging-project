"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Layers, Loader2, UploadCloud } from "lucide-react";

import { UploadZone, UploadDetails } from "@/components/upload/UploadZone";
import { Button } from "@/components/ui/Button";
import { ModalityBadge } from "@/components/ui/Badge";
import { NOT_AVAILABLE, type UploadedStudyRecord } from "@/lib/uploads/types";

/**
 * ---------------------------------------------------------------------------
 * UPLOAD
 * ---------------------------------------------------------------------------
 * One flow, in every data mode: the dropped files are read in this browser,
 * stored in this browser, and become a new study of their own.
 *
 * What used to be here was two flows, and neither of them ended at the scan
 * that was uploaded. In mock/demo mode the files were handed to
 * `createDemoStudy`, which invented a study around the typed modality and left
 * the real pixels behind — and the id it invented was not in
 * `public/demo-data/index.json`, so opening it in the deployed build said
 * "Study not found". In dataset mode the files were hashed and looked up in the
 * index, so what opened was a *committed* study the upload happened to match,
 * carrying that study's patient, report, findings and measurements.
 *
 * Neither is what an upload means, so both are gone. Nothing on this page
 * consults the demo index or the dataset manifest; nothing is matched on hash,
 * filename, patient name, accession number, study code or modality; no existing
 * study is read at all. The new study's id comes from `parseUpload` — time plus
 * randomness, never content — and its report is composed from these files' own
 * headers by `lib/uploads/to-study.ts`.
 *
 * There is no analysis stage to show, because this build has no model that
 * reads pixels. The panel below reports the two things that actually happen:
 * the files are read, and the bytes are stored.
 *
 * Both modules are imported on submit rather than at module scope: `parse.ts`
 * statically imports `dicom-parser` and `nifti-reader-js`, which have no
 * business in the bundle of a page that has not been given a file yet.
 * ---------------------------------------------------------------------------
 */
type Phase =
  | { kind: "form" }
  | { kind: "reading"; fileCount: number }
  | { kind: "stored"; record: UploadedStudyRecord }
  | { kind: "error"; message: string };

export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const onStart = async (files: File[], details: UploadDetails) => {
    setPhase({ kind: "reading", fileCount: files.length });
    try {
      const [parse, store] = await Promise.all([import("@/lib/uploads/parse"), import("@/lib/uploads/db")]);

      /*
       * Everything the study is made of comes out of this one call: the files'
       * own DICOM/NIfTI headers, the values typed on the form, and a per-field
       * record of which of the two supplied each. It rejects only when nothing
       * at all could be read; a partly readable upload becomes a study of what
       * was readable, and names the rest in `record.rejected`.
       */
      const { record, blobs } = await parse.parseUpload(files, details);

      /*
       * `putUpload` returns the record with the storage it actually achieved —
       * "persistent" for IndexedDB, "session" when that was unavailable — so
       * the card reports where the bytes really went rather than where they
       * were meant to go.
       */
      setPhase({ kind: "stored", record: await store.putUpload(record, blobs) });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "These files could not be read." });
    }
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
            Read a DICOM, NIfTI, or image file into a new study of its own.
          </p>
        </div>
      </div>

      {phase.kind === "form" && <UploadZone onStart={onStart} />}
      {phase.kind === "reading" && <ReadingPanel fileCount={phase.fileCount} />}
      {phase.kind === "error" && <ErrorPanel message={phase.message} onReset={reset} />}
      {phase.kind === "stored" && <StoredCard record={phase.record} onReset={reset} />}
    </div>
  );
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Reading is real work — a 400-slice series is 400 header parses — so this is a
 * spinner over the two things happening, and deliberately not a staged
 * timeline. Stages named "AI Analysis", "Findings" and "Report Draft" would be
 * describing a pipeline this build does not have.
 */
function ReadingPanel({ fileCount }: { fileCount: number }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-clinical" />
        <div className="min-w-0">
          <h3 className="text-card-title text-ink-primary">Reading {plural(fileCount, "file")}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
            Headers and pixels are read in this browser and stored in this browser. Nothing is sent to a server, and
            nothing is compared against the existing studies — these files are becoming a new study of their own.
          </p>
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
          <h3 className="text-card-title text-ink-primary">Could not read this upload</h3>
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
 * What was created, described only in terms of what was read.
 *
 * No confidence band and no finding count, which is the substantive difference
 * from the card this replaces: both were seeded numbers from `createDemoStudy`,
 * and there is nothing here that could produce either honestly. The study opens
 * with `aiStatus: "not-run"`, and the line below says so rather than leaving an
 * empty findings list to read as "nothing abnormal seen".
 */
function StoredCard({ record, onReset }: { record: UploadedStudyRecord; onReset: () => void }) {
  const images = record.series.reduce((sum, s) => sum + s.frames.length, 0);
  const totalBytes = record.files.reduce((sum, f) => sum + f.bytes, 0);

  return (
    <div className="rounded-xl border border-success/30 bg-panel p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-dim text-success">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-ink-primary">New study created</h3>
      <p className="mt-1.5 text-[13px] text-ink-secondary">
        {record.studyCode} · {record.patientAlias ?? NOT_AVAILABLE}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <ModalityBadge modality={record.modality} />
        {record.bodyRegion && <span className="text-[12.5px] text-ink-secondary">{record.bodyRegion}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-clinical" />
          {plural(record.series.length, "series", "series")} · {plural(images, "image")}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-clinical" />
          {plural(record.files.length, "file")} ({bytesLabel(totalBytes)})
        </span>
      </div>

      <p className="mx-auto mt-4 max-w-md text-[12px] leading-relaxed text-ink-muted">
        The report for this study is composed from these files&apos; own headers. No automated image analysis was run —
        this build has no model that reads pixels — so the study carries no findings, and nothing in it comes from
        another study.
      </p>

      <RejectedFiles record={record} />
      <StorageNote record={record} />

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        <Link href={`/studies/${record.id}?tab=analysis`}>
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

/**
 * Files this build could not read, named individually.
 *
 * A silent count would be worse than useless here: if 3 of 40 slices were
 * unreadable the series is short by three images, and the person who uploaded
 * them is the only one who can tell whether that matters.
 */
function RejectedFiles({ record }: { record: UploadedStudyRecord }) {
  if (record.rejected.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-warning/30 bg-warning-dim/40 p-3 text-left">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-primary">
            {plural(record.rejected.length, "file")} could not be read and {record.rejected.length === 1 ? "is" : "are"}{" "}
            not part of this study
          </p>
          <ul className="mt-1.5 space-y-1">
            {record.rejected.map((r) => (
              <li key={r.name} className="text-[12px] leading-relaxed text-ink-secondary">
                <span className="text-ink-primary">{r.name}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the bytes went, but only when it is not where they were meant to go.
 *
 * "persistent" is the ordinary case and needs no announcement. "session" means
 * IndexedDB was unavailable — a private window, a quota refusal, a blocked
 * upgrade — and the study is then real but temporary, which the person has to
 * know *before* they close the tab rather than after.
 */
function StorageNote({ record }: { record: UploadedStudyRecord }) {
  if (record.storage !== "session") return null;

  return (
    <p className="mx-auto mt-3 max-w-md text-[12px] leading-relaxed text-warning">
      This browser&apos;s persistent storage was unavailable, so the study is held in memory for this tab only. It will
      open and display normally now, but a page reload will lose it.
    </p>
  );
}

