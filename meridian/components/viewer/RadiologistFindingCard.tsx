"use client";

import { Crosshair, FileCheck2, Pencil, Trash2 } from "lucide-react";
import { RadiologistFinding } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function RadiologistFindingCard({
  finding,
  isActive,
  onHover,
  onSelect,
  onEdit,
  onDelete,
  onAddToReport,
  locationLabel,
}: {
  finding: RadiologistFinding;
  isActive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToReport: (id: string) => void;
  locationLabel?: string;
}) {
  return (
    <div
      onMouseEnter={() => onHover(finding.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "rounded-lg border border-l-[3px] border-l-secondary p-3.5 transition-all duration-150",
        "border-secondary/40 bg-secondary-dim",
        isActive && "ring-1 ring-secondary/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-secondary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-strong">
          <Pencil className="h-2.5 w-2.5" /> Radiologist Finding
        </span>
        <button onClick={() => onSelect(finding.id)} className="shrink-0 text-ink-muted transition-transform hover:scale-110 hover:text-secondary-strong" aria-label="Focus on image">
          <Crosshair className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-primary">{finding.text}</p>

      {(finding.findingType || finding.location || finding.severity || finding.confidence) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {finding.findingType && <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10.5px] text-ink-secondary">{finding.findingType}</span>}
          {finding.location && <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10.5px] text-ink-secondary">{finding.location}</span>}
          {finding.severity && <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10.5px] text-ink-secondary">Severity: {finding.severity}</span>}
          {finding.confidence && <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10.5px] text-ink-secondary">{finding.confidence}</span>}
        </div>
      )}

      {finding.radiologistNote && <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{finding.radiologistNote}</p>}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {locationLabel && (
          <p className="font-mono text-[10.5px] text-ink-muted">
            Source: Radiologist annotation · {locationLabel}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Button size="sm" variant={finding.addedToReport ? "success" : "outline"} className="flex-1" disabled={finding.addedToReport} onClick={() => onAddToReport(finding.id)}>
          <FileCheck2 className="h-3.5 w-3.5" /> {finding.addedToReport ? "Added to Report" : "Add to Report"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(finding.id)} aria-label="Edit finding">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDelete(finding.id)} aria-label="Delete finding">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
