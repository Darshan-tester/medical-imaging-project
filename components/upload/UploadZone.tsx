"use client";

import { useEffect, useRef, useState } from "react";
import { UploadCloud, File as FileIcon, ImageIcon, X, ArrowRight, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modality, StudyPriority } from "@/lib/types";
import { bmiFrom, bsaFrom } from "@/lib/patient-profile";
import { cn } from "@/lib/utils";

export interface UploadDetails {
  patientAlias: string;
  modality: Modality;
  bodyRegion: string;
  priority: StudyPriority;
  /*
   * Demographics and anthropometrics. All optional: the analysis is normalized
   * against them where they exist (SUV body-weight, contrast and dose by
   * weight, BSA-indexed measurements), and anything left blank is filled with a
   * deterministic demo value that the report badges as such rather than being
   * silently invented here. See `lib/patient-profile.ts`.
   */
  age?: number;
  sex?: "M" | "F" | "Other";
  heightCm?: number;
  weightKg?: number;
  /** One condition per line as typed; empty lines dropped. */
  history?: string[];
  notes?: string;
}


const MODALITIES: Modality[] = ["CT", "MRI", "X-Ray", "Ultrasound", "PET", "Mammography"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "analyze" is the original seeded-demo flow: the typed modality/region drive
 * `createDemoStudy`, so they are required. "match" hashes the files against the
 * indexed dataset instead, where nothing typed here affects the result — so the
 * form is not shown rather than left on screen doing nothing.
 */
export type UploadZoneMode = "analyze" | "match";

export function UploadZone({ onStart, mode = "analyze" }: { onStart: (files: File[], details: UploadDetails) => void; mode?: UploadZoneMode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const [details, setDetails] = useState<UploadDetails>({
    patientAlias: "",
    modality: "CT",
    bodyRegion: "",
    priority: "routine",
  });

  /*
   * Numeric and multi-line inputs are held as raw strings while the user types.
   * Parsing on every keystroke would make "1" out of a half-typed "17", and
   * clearing a field would snap it back to a number rather than to blank.
   */
  const [raw, setRaw] = useState({ age: "", sex: "", heightCm: "", weightKg: "", history: "", notes: "" });

  const num = (s: string): number | undefined => {
    const n = Number(s.trim());
    return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const heightCm = num(raw.heightCm);
  const weightKg = num(raw.weightKg);
  /* Shown live, so it is obvious these are computed rather than asked for. */
  const liveBmi = heightCm !== undefined && weightKg !== undefined ? bmiFrom(heightCm, weightKg) : undefined;
  const liveBsa = heightCm !== undefined && weightKg !== undefined ? bsaFrom(heightCm, weightKg) : undefined;

  const submittedDetails = (): UploadDetails => {
    const history = raw.history
      .split("\n")
      .map((line) => line.replace(/^[-•*\s]+/, "").trim())
      .filter((line) => line.length > 0);
    return {
      ...details,
      age: num(raw.age),
      sex: raw.sex === "M" || raw.sex === "F" || raw.sex === "Other" ? raw.sex : undefined,
      heightCm,
      weightKg,
      history: history.length > 0 ? history : undefined,
      notes: raw.notes.trim() ? raw.notes.trim() : undefined,
    };
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  // Build a live, real preview (object URL) for every image/* file so the
  // person sees the exact scan they just picked — not a placeholder — the
  // moment they add it. Old URLs are revoked as files are removed/replaced.
  useEffect(() => {
    setPreviews((prev) => {
      const next = new Map<File, string>();
      files.forEach((f) => {
        if (f.type.startsWith("image/")) {
          next.set(f, prev.get(f) ?? URL.createObjectURL(f));
        }
      });
      prev.forEach((url, f) => {
        if (!next.has(f)) URL.revokeObjectURL(url);
      });
      return next;
    });
  }, [files]);

  useEffect(
    () => () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const heroPreview = files.length > 0 ? previews.get(files[0]) : undefined;
  const canStart = files.length > 0 && (mode === "match" || details.bodyRegion.trim().length > 0);

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition-all duration-200",
          heroPreview ? "px-6 py-6" : "px-6 py-14",
          dragOver ? "border-clinical bg-clinical-dim scale-[1.01]" : "border-border-strong bg-panel hover:border-clinical/40"
        )}
      >
        {/*
          DICOM and NIfTI are here because the demo pack exports CT as a .dcm
          instance and MRI/PET as their .nii.gz volume. Neither renders in an
          <img>, but matching only needs the bytes — the study that opens is what
          gets displayed.
        */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.dcm,.dicom,.nii,.nii.gz"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        {heroPreview ? (
          <div className="flex w-full flex-col items-center gap-3">
            <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-lg border border-border-strong bg-viewer shadow-elevated sm:h-44 sm:w-44">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroPreview} alt="Selected scan preview" className="h-full w-full object-cover" draggable={false} />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-full animate-monitor-scan bg-gradient-to-b from-clinical/20 via-transparent to-transparent" />
              <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur">
                <Eye className="h-2.5 w-2.5" /> Live preview
              </span>
            </div>
            <p className="text-[13px] font-medium text-ink-primary">
              {files.length} file{files.length > 1 ? "s" : ""} ready · click or drop to add more
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-clinical/15 text-clinical transition-transform duration-200 group-hover:scale-110">
              <UploadCloud className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <p className="mt-4 text-[14px] font-medium text-ink-primary">Drag and drop scan files, or click to browse</p>
            <p className="mt-1.5 text-[12.5px] text-ink-secondary">
              Single images or full CT/MRI series — X-ray, CT, MRI, Ultrasound, PET, Mammography
            </p>
          </>
        )}
      </div>

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-[12.5px] font-medium text-ink-primary">
              {files.length} file{files.length > 1 ? "s" : ""} selected
              {files.length > 1 && <span className="ml-1.5 text-ink-muted">· {files.length} slices detected</span>}
            </p>
            <button onClick={() => setFiles([])} className="text-[11.5px] text-ink-muted hover:text-critical">
              Clear all
            </button>
          </div>
          <div className="max-h-56 divide-y divide-border overflow-y-auto">
            {files.map((f, i) => {
              const preview = previews.get(f);
              return (
                <div key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-border-strong" draggable={false} />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-panel-alt text-ink-muted">
                      <FileIcon className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">{f.name}</span>
                  {preview && <ImageIcon className="h-3 w-3 shrink-0 text-clinical" aria-label="Image preview available" />}
                  <span className="shrink-0 text-[11px] text-ink-muted">{formatBytes(f.size)}</span>
                  <button onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 text-ink-muted hover:text-critical">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === "match" ? (
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">How the match works</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
            Each file is hashed and looked up against the indexed dataset. On a hit the app opens that study&apos;s real images, its real
            reconstructed planes and the radiology report that shipped with the dataset. Nothing is predicted, scored or generated — if a
            file is not in the index, it is reported as unmatched rather than given findings.
          </p>
          <p className="mt-3 text-[11px] text-ink-muted">
            Files are hashed in memory and never written to disk. Modality and body region are read from the matched study, so there is
            nothing to type here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">Study Details</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Patient Identifier (alias)</label>
              <Input
                value={details.patientAlias}
                onChange={(e) => setDetails((d) => ({ ...d, patientAlias: e.target.value }))}
                placeholder="e.g. Patient K-4471"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Modality</label>
              <Select value={details.modality} onChange={(e) => setDetails((d) => ({ ...d, modality: e.target.value as Modality }))}>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Body Region *</label>
              <Input
                value={details.bodyRegion}
                onChange={(e) => setDetails((d) => ({ ...d, bodyRegion: e.target.value }))}
                placeholder="e.g. Chest, Brain, Knee (R)"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Priority</label>
              <Select value={details.priority} onChange={(e) => setDetails((d) => ({ ...d, priority: e.target.value as StudyPriority }))}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">STAT</option>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Age (years)</label>
              <Input
                type="number"
                min={0}
                max={120}
                inputMode="numeric"
                value={raw.age}
                onChange={(e) => setRaw((r) => ({ ...r, age: e.target.value }))}
                placeholder="e.g. 54"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Sex</label>
              <Select value={raw.sex} onChange={(e) => setRaw((r) => ({ ...r, sex: e.target.value }))}>
                <option value="">Not specified</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Height (cm)</label>
              <Input
                type="number"
                min={30}
                max={250}
                inputMode="decimal"
                value={raw.heightCm}
                onChange={(e) => setRaw((r) => ({ ...r, heightCm: e.target.value }))}
                placeholder="e.g. 172"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Weight (kg)</label>
              <Input
                type="number"
                min={1}
                max={400}
                inputMode="decimal"
                value={raw.weightKg}
                onChange={(e) => setRaw((r) => ({ ...r, weightKg: e.target.value }))}
                placeholder="e.g. 78.5"
              />
            </div>
          </div>

          {/*
            BMI and BSA are computed, never typed — asking for them invites a
            value that disagrees with the height and weight beside it. BSA uses
            Mosteller, √(cm × kg / 3600).
          */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-panel-alt px-3 py-2">
              <p className="text-[11px] text-ink-muted">BMI (computed)</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink-primary tabular-nums">
                {liveBmi !== undefined ? `${liveBmi.toFixed(1)} kg/m²` : <span className="font-normal text-ink-muted">Needs height + weight</span>}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-panel-alt px-3 py-2">
              <p className="text-[11px] text-ink-muted">BSA (computed · Mosteller)</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink-primary tabular-nums">
                {liveBsa !== undefined ? `${liveBsa.toFixed(2)} m²` : <span className="font-normal text-ink-muted">Needs height + weight</span>}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">
                Relevant history / pre-existing conditions
              </label>
              <Textarea
                rows={3}
                value={raw.history}
                onChange={(e) => setRaw((r) => ({ ...r, history: e.target.value }))}
                placeholder={"One per line, e.g.\nFormer smoker, ~20 pack-years\nHypertension"}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Special notes</label>
              <Textarea
                rows={3}
                value={raw.notes}
                onChange={(e) => setRaw((r) => ({ ...r, notes: e.target.value }))}
                placeholder="Anything that changes how the images should be read — e.g. portable AP technique, unable to fully inspire"
              />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-ink-muted">
            This is a demo environment — modality and region are provided manually rather than parsed from real DICOM metadata. Demographics
            are optional; anything left blank is filled with a deterministic demo value, and the report marks it as one.
          </p>
        </div>
      )}

      <Button variant="primary" size="lg" className="w-full" disabled={!canStart} onClick={() => onStart(files, submittedDetails())}>
        {mode === "match" ? "Match to Indexed Study" : "Start Upload & Analysis"} <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
