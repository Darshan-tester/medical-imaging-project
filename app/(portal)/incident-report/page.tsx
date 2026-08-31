"use client";

import { useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import { IncidentCard } from "@/components/incident/IncidentCard";
import { IncidentForm } from "@/components/incident/IncidentForm";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { INCIDENTS } from "@/lib/mock-data";
import { IncidentReport, IncidentStatus } from "@/lib/types";
import { useUIStore } from "@/lib/store";

export default function IncidentReportPage() {
  const [incidents, setIncidents] = useState<IncidentReport[]>(INCIDENTS);
  const [formOpen, setFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("all");
  const pushToast = useUIStore((s) => s.pushToast);

  const filtered = incidents.filter((i) => statusFilter === "all" || i.status === statusFilter);

  const onSubmit = (incident: IncidentReport) => {
    setIncidents((prev) => [incident, ...prev]);
    setFormOpen(false);
    pushToast({ title: "Incident report submitted", description: incident.incidentType, tone: "default" });
  };

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <ShieldAlert className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h1 className="text-section-title text-ink-primary">Incident Reports</h1>
            <p className="text-[12.5px] text-ink-secondary">Track AI discrepancies, workflow issues, and quality events.</p>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" /> New Report
        </Button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as IncidentStatus | "all")} className="w-auto min-w-[150px]">
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="under-review">Under Review</option>
          <option value="resolved">Resolved</option>
        </Select>
        <span className="text-[12px] text-ink-muted">{filtered.length} reports</span>
      </div>

      <div className="mt-5 space-y-4">
        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No incident reports"
            description="Nothing matches this filter yet. Reports you submit will appear here."
            action={{ label: "New Report", onClick: () => setFormOpen(true) }}
          />
        ) : (
          filtered.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
        )}
      </div>

      <Drawer open={formOpen} onClose={() => setFormOpen(false)} title="New Incident Report" widthClassName="w-full max-w-md">
        <IncidentForm onSubmit={onSubmit} onCancel={() => setFormOpen(false)} />
      </Drawer>
    </div>
  );
}
