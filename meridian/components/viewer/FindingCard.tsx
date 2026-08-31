"use client";

import { useState } from "react";
import { Check, MessageSquare, X, Crosshair } from "lucide-react";
import { Finding } from "@/lib/types";
import { ConfidenceRing } from "@/components/ui/ConfidenceIndicator";
import { ConfidenceBand } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const BAND_ACCENT: Record<Finding["band"], string> = {
  high: "border-l-success",
  moderate: "border-l-warning",
  low: "border-l-critical",
};

const FLASH_CLASS: Partial<Record<Finding["status"], string>> = {
  accepted: "status-flash-success",
  modified: "status-flash-warning",
  rejected: "status-flash-critical",
};

export function FindingCard({
  index,
  finding,
  isActive,
  onHover,
  onSelect,
  onUpdate,
  locationLabel,
}: {
  index: number;
  finding: Finding;
  isActive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Finding>) => void;
  /** e.g. "CT Axial · Slice 42" — shown so a radiologist knows what clicking the crosshair will navigate to. */
  locationLabel?: string;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const isNegative = finding.label.toLowerCase().startsWith("no ");

  const statusStyles: Record<Finding["status"], string> = {
    pending: "border-border",
    accepted: "border-success/40 bg-success-dim/40",
    modified: "border-warning/40 bg-warning-dim/40",
    rejected: "border-critical/40 bg-critical-dim/30 opacity-60",
  };

  const flashClass = FLASH_CLASS[finding.status];

  return (
    <div
      key={finding.status}
      onMouseEnter={() => !isNegative && onHover(finding.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "rounded-lg border border-l-[3px] p-3.5 transition-all duration-150",
        statusStyles[finding.status],
        !isNegative && BAND_ACCENT[finding.band],
        isActive && "ring-1 ring-clinical/50",
        flashClass
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 font-mono text-[11px] font-medium text-ink-muted">{String(index + 1).padStart(2, "0")}</span>
        {!isNegative ? (
          <ConfidenceRing value={finding.confidence} band={finding.band} size={38} />
        ) : (
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[rgb(var(--overlay-hover)/0.05)] text-ink-muted">
            <Check className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-semibold leading-snug text-ink-primary">{finding.label}</p>
            {!isNegative && (
              <button onClick={() => onSelect(finding.id)} className="shrink-0 text-ink-muted transition-transform hover:scale-110 hover:text-clinical" aria-label="Focus on image">
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {!isNegative && <div className="mt-1"><ConfidenceBand band={finding.band} /></div>}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{finding.description}</p>
          {locationLabel && <p className="mt-1.5 font-mono text-[10.5px] text-ink-muted">{locationLabel}</p>}
        </div>
      </div>

      {!isNegative && (
        <>
          <div className="mt-3 flex items-center gap-1.5">
            <Button
              size="sm"
              variant={finding.status === "accepted" ? "success" : "outline"}
              className="flex-1"
              onClick={() => onUpdate(finding.id, { status: "accepted" })}
            >
              <Check className="h-3.5 w-3.5" /> Accept
            </Button>
            <Button
              size="sm"
              variant={finding.status === "modified" ? "secondary" : "outline"}
              className="flex-1"
              onClick={() => {
                onUpdate(finding.id, { status: "modified" });
                setNoteOpen(true);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Modify
            </Button>
            <Button
              size="sm"
              variant={finding.status === "rejected" ? "critical" : "outline"}
              className="flex-1"
              onClick={() => onUpdate(finding.id, { status: "rejected" })}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>

          {(noteOpen || finding.radiologistNote) && (
            <Textarea
              value={finding.radiologistNote ?? ""}
              onChange={(e) => onUpdate(finding.id, { radiologistNote: e.target.value })}
              placeholder="Add a radiologist note or correction…"
              rows={2}
              className="mt-2.5 text-[12px]"
            />
          )}
        </>
      )}
    </div>
  );
}
