"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea, Input, Select } from "@/components/ui/Input";
import { RadiologistFinding } from "@/lib/types";

export interface FindingDraft {
  text: string;
  findingType: string;
  location: string;
  severity: string;
  confidence: string;
  radiologistNote: string;
}

const EMPTY_DRAFT: FindingDraft = { text: "", findingType: "", location: "", severity: "", confidence: "", radiologistNote: "" };

export function AnnotationEditor({
  open,
  onClose,
  onSave,
  editingFinding,
  locationLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (draft: FindingDraft) => void;
  /** Pass an existing finding to edit it in place; omit to create a new one. */
  editingFinding?: RadiologistFinding | null;
  /** e.g. "CT Axial · Slice 42" — shown so the radiologist can confirm what they're describing. */
  locationLabel?: string;
}) {
  const [draft, setDraft] = useState<FindingDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(
      editingFinding
        ? {
            text: editingFinding.text,
            findingType: editingFinding.findingType ?? "",
            location: editingFinding.location ?? "",
            severity: editingFinding.severity ?? "",
            confidence: editingFinding.confidence ?? "",
            radiologistNote: editingFinding.radiologistNote ?? "",
          }
        : EMPTY_DRAFT
    );
  }, [open, editingFinding]);

  const canSave = draft.text.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingFinding ? "Edit Finding" : "Add Finding"}
      description={locationLabel ? `Radiologist observation · ${locationLabel}` : "Radiologist observation"}
      size="md"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">Finding</label>
          <Textarea
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="Describe the finding…"
            rows={5}
            className="text-[13px] leading-relaxed"
          />
          <p className="mt-1.5 text-[11px] text-ink-muted">Stored exactly as written — never rewritten, summarized, or edited by AI.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Finding type (optional)</label>
            <Input
              value={draft.findingType}
              onChange={(e) => setDraft((d) => ({ ...d, findingType: e.target.value }))}
              placeholder="e.g. Mass, Nodule, Fracture"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Location (optional)</label>
            <Input
              value={draft.location}
              onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder="e.g. Right frontal lobe"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Severity (optional)</label>
            <Select value={draft.severity} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))}>
              <option value="">—</option>
              <option value="Low">Low</option>
              <option value="Moderate">Moderate</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Confidence (optional)</label>
            <Select value={draft.confidence} onChange={(e) => setDraft((d) => ({ ...d, confidence: e.target.value }))}>
              <option value="">—</option>
              <option value="Definite">Definite</option>
              <option value="Probable">Probable</option>
              <option value="Possible">Possible</option>
              <option value="Indeterminate">Indeterminate</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Radiologist note (optional)</label>
          <Textarea
            value={draft.radiologistNote}
            onChange={(e) => setDraft((d) => ({ ...d, radiologistNote: e.target.value }))}
            placeholder="Additional context, follow-up recommendation, etc."
            rows={2}
            className="text-[12.5px]"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={() => onSave(draft)}>
          Save Finding
        </Button>
      </div>
    </Modal>
  );
}
