import { Study } from "@/lib/types";
import { FieldSource, PatientProfile, ProfileField } from "@/lib/patient-profile";
import { DatasetSourceBadge, ModalityBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { formatDateTime } from "@/lib/utils";
import { UserRound } from "lucide-react";

/**
 * Marks a value that was generated rather than supplied by the source dataset.
 *
 * Not decoration. These public datasets carry real images and real reports and
 * no demographics at all — 0 of 2,314 studies have an age or a sex. A height
 * and a BMI sitting unmarked in a clinical-looking panel would read as having
 * come from the patient record, so every generated value says so, in place.
 */
function DemoTag() {
  return (
    <span
      title="Demo value — generated deterministically from the study ID. Not present in the source dataset."
      className="rounded border border-warning/40 bg-warning/10 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-warning"
    >
      demo
    </span>
  );
}

/** Renders one profile field, badged when it is not real. */
function Value<T>({ field, format }: { field?: ProfileField<T>; format?: (v: T) => string }) {
  if (!field) return <span className="text-ink-muted">Not available</span>;
  const text = format ? format(field.value) : String(field.value);
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {needsTag(field.source) ? <DemoTag /> : null}
    </span>
  );
}

function needsTag(source: FieldSource): boolean {
  return source === "simulated";
}

const SEX_LABEL: Record<"M" | "F" | "Other", string> = { M: "Male", F: "Female", Other: "Other" };

export function StudySummaryCard({ study }: { study: Study }) {
  const p: PatientProfile | undefined = study.patientProfile;

  /*
   * The profile wins over `study.age` / `study.sex` whenever it exists, because
   * the profile is the only thing that knows where its value came from. The raw
   * fields carry a number and nothing else: for a seeded demo study they hold a
   * generated age, and reading them first would print it with no badge. Where a
   * real age does exist it was passed into the profile as `source`, so the
   * profile shows the same number with the right provenance.
   *
   * The raw fields are still the fallback, for any study built without a profile.
   */
  const ageField: ProfileField<number> | undefined =
    p?.age ?? (study.age !== undefined ? { value: study.age, source: "source" } : undefined);
  const sexField: ProfileField<"M" | "F" | "Other"> | undefined =
    p?.sex ?? (study.sex !== undefined ? { value: study.sex, source: "source" } : undefined);

  const rows: [string, React.ReactNode][] = [
    ["Study ID", <span key="1" className="font-mono">{study.studyId}</span>],
    ["Patient", p ? <Value key="name" field={p.name} /> : study.patientAlias],
    ["Age", <Value key="age" field={ageField} format={(v) => `${v} y`} />],
    ["Sex", <Value key="sex" field={sexField} format={(v) => SEX_LABEL[v]} />],
    ["Height", <Value key="h" field={p?.heightCm} format={(v) => `${v} cm`} />],
    ["Weight", <Value key="w" field={p?.weightKg} format={(v) => `${v} kg`} />],
    ["BMI", <Value key="bmi" field={p?.bmi} format={(v) => `${v.toFixed(1)} kg/m²`} />],
    ["BSA", <Value key="bsa" field={p?.bsaM2} format={(v) => `${v.toFixed(2)} m²`} />],
    ["Modality", <ModalityBadge key="2" modality={study.modality} />],
    ["Region", study.bodyRegion ?? <span key="r" className="text-ink-muted">Not available</span>],
    ["Study Date", study.date ? formatDateTime(study.date) : <span key="d" className="text-ink-muted">Not available</span>],
    ["Priority", <PriorityBadge key="3" priority={study.priority} />],
    ["Status", <StatusBadge key="4" status={study.status} />],
    ...(study.datasetSource ? ([["Source", <DatasetSourceBadge key="5" source={study.datasetSource} />]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <div>
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink-primary">Study Summary</h3>
      </div>
      <ScanThumbnail
        seed={study.thumbnailSeed}
        modality={study.modality}
        imageUrl={study.imageUrls?.[0]}
        animated
        className="h-36 w-full border-b border-border"
      />
      <div className="space-y-3 p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[11.5px] text-ink-muted">{label}</span>
            <span className="text-right text-[12.5px] font-medium text-ink-primary">{value}</span>
          </div>
        ))}

        {/*
          History and notes are rendered whether or not there is a value, unlike
          the rows above which always have one. A section that disappears when
          empty leaves no way to tell "this patient has no relevant history" from
          "history was never part of this panel" — and the imaging analysis is
          described in terms of these parameters, so their absence is itself
          information. "Not available" is the honest form of it: these datasets
          carry no history for any study, so nothing here is a clinical negative.
        */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-ink-muted">Relevant history / pre-existing conditions</span>
            {p?.history && needsTag(p.history.source) ? <DemoTag /> : null}
          </div>
          {p?.history && p.history.value.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {p.history.value.map((h) => (
                <li key={h} className="flex gap-1.5 text-[12px] leading-snug text-ink-primary">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">Not available</p>
          )}
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-ink-muted">Special notes</span>
            {p?.notes && needsTag(p.notes.source) ? <DemoTag /> : null}
          </div>
          <p className={`mt-1.5 text-[12px] leading-snug ${p?.notes ? "text-ink-primary" : "text-ink-muted"}`}>
            {p?.notes ? p.notes.value : "Not available"}
          </p>
        </div>

        <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-panel-alt px-3 py-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/15 text-ai">
            <UserRound className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-medium text-ink-primary">{study.assignedRadiologist?.name ?? "Unassigned"}</p>
            <p className="text-[10.5px] text-ink-muted">{study.assignedRadiologist?.role ?? "Awaiting assignment"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
