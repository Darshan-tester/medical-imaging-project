"use client";

import { FormEvent, useState } from "react";
import { IncidentReport, IncidentSeverity } from "@/lib/types";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CURRENT_USER, listStudies } from "@/lib/mock-data";

export function IncidentForm({ onSubmit, onCancel }: { onSubmit: (incident: IncidentReport) => void; onCancel: () => void }) {
  const studies = listStudies().slice(0, 20);
  const [incidentType, setIncidentType] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [studyId, setStudyId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [findings, setFindings] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!incidentType.trim() || !description.trim()) {
      setError("Incident type and description are required.");
      return;
    }
    onSubmit({
      id: `inc-${Date.now()}`,
      incidentType: incidentType.trim(),
      severity,
      studyId: studyId || null,
      description: description.trim(),
      findings: findings.trim() || "N/A",
      actionTaken: actionTaken.trim() || "Pending",
      reviewer: CURRENT_USER,
      createdAt: new Date().toISOString(),
      status: "open",
    });
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Incident Type *</label>
          <Input value={incidentType} onChange={(e) => setIncidentType(e.target.value)} placeholder="e.g. AI Misclassification" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Severity</label>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Related Study</label>
            <Select value={studyId} onChange={(e) => setStudyId(e.target.value)}>
              <option value="">None</option>
              {studies.map((s) => (
                <option key={s.id} value={s.studyId}>
                  {s.studyId} — {s.patientAlias}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Description *</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What happened?" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Findings</label>
          <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} placeholder="Relevant clinical or technical findings" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Action Taken</label>
          <Textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} placeholder="Steps taken or planned" />
        </div>

        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-2.5 border-t border-border p-4">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          Submit Report
        </Button>
      </div>
    </form>
  );
}
