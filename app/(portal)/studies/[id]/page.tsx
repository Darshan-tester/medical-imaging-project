"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchStudy, fetchStudies } from "@/lib/data-source";
import { Finding, ReportSection, Study } from "@/lib/types";
import { ErrorState } from "@/components/ui/EmptyState";
import { ClinicalWorkstation } from "@/components/viewer/ClinicalWorkstation";
import { ClinicalWorkflowMode } from "@/components/viewer/ClinicalTopBar";
import { useUIStore, useAuthStore } from "@/lib/store";
import { SessionAnnotationStore } from "@/lib/annotation-store";
import { AuditTrail } from "@/lib/audit-trail";

export default function StudyWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [study, setStudy] = useState<Study | undefined>(undefined);
  const [allStudies, setAllStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Map requested tab query to ClinicalWorkflowMode
  const requestedTab = searchParams.get("tab");
  const initialMode: ClinicalWorkflowMode = useMemo(() => {
    if (requestedTab === "3d") return "3d";
    if (requestedTab === "4d") return "4d";
    if (requestedTab === "ai") return "ai";
    if (requestedTab === "report") return "report";
    return "images"; // default 2D / MPR
  }, [requestedTab]);

  const pushToast = useUIStore((s) => s.pushToast);
  const { user } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    // Fast path: load the active study directly (<100ms) without waiting for all 2,300+ studies
    fetchStudy(params.id)
      .then((s) => {
        if (cancelled) return;
        let finalStudy = s;
        if (s) {
          const saved = SessionAnnotationStore.load(s.id);
          if (saved?.reportSections) {
            finalStudy = {
              ...s,
              report: {
                ...s.report,
                sections: saved.reportSections,
              },
            };
          }
        }
        setStudy(finalStudy);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Unable to load this clinical study.");
        setLoading(false);
      });

    // Asynchronous background hydration of priors for comparison panel
    fetchStudies()
      .then((all) => {
        if (!cancelled) setAllStudies(all);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-base py-24 select-none">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-panel px-6 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-clinical" />
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-ink-primary">Opening Study...</span>
            <span className="text-[11.5px] text-ink-muted">Loading DICOM metadata and initial slices</span>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title="Unable to load this series"
          description={loadError}
          action={{ label: "Retry", onClick: () => router.refresh() }}
        />
      </div>
    );
  }

  if (!study) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title="Study not found"
          description="This patient study could not be located in the PACS archive or may have been archived."
          action={{ label: "Back to Studies", onClick: () => router.push("/studies") }}
        />
      </div>
    );
  }

  const onUpdateFinding = (id: string, patch: Partial<Finding>) => {
    setStudy((prev) =>
      prev ? { ...prev, findings: prev.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) } : prev
    );
  };

  const onChangeSections = (sections: ReportSection) => {
    setStudy((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, report: { ...prev.report, sections } };
      const currentSaved = SessionAnnotationStore.load(prev.id);
      SessionAnnotationStore.save({
        studyId: prev.id,
        updatedAt: new Date().toISOString(),
        annotations: currentSaved?.annotations || [],
        measurements: currentSaved?.measurements || [],
        markers: currentSaved?.markers || [],
        findings: prev.findings,
        reportSections: sections,
        acknowledgedCriticalFindings: currentSaved?.acknowledgedCriticalFindings || [],
      });
      return updated;
    });
  };

  const onAppendFindingToReport = (text: string) => {
    setStudy((prev) => {
      if (!prev) return prev;
      const existing = prev.report.sections.findings.trimEnd();
      const block = `Radiologist observation:\n${text}`;
      const findings = existing.length > 0 ? `${existing}\n\n${block}` : block;
      return { ...prev, report: { ...prev.report, sections: { ...prev.report.sections, findings } } };
    });
    pushToast({
      title: "Added to report",
      description: "Observation appended to the report Findings section.",
      tone: "success",
    });
  };

  const onApprove = () => {
    if (!study) return;
    AuditTrail.record(study.id, "REPORT_APPROVED", user, {
      reportVersion: study.report.version + 1,
      patientAlias: study.patientAlias,
    });
    setStudy((prev) =>
      prev
        ? {
            ...prev,
            status: "approved",
            report: {
              ...prev.report,
              status: "approved",
              reviewer: {
                id: user.id || "usr-chen",
                name: user.name,
                initials: user.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 3),
                role: user.role,
              },
              approvedAt: new Date().toISOString(),
              version: prev.report.version + 1,
            },
          }
        : prev
    );
    pushToast({
      title: "Report Finalized",
      description: `Study ${study.studyId} signed and finalized by ${user.name}.`,
      tone: "success",
    });
  };

  return (
    <ClinicalWorkstation
      study={study}
      initialMode={initialMode}
      onUpdateFinding={onUpdateFinding}
      onChangeSections={onChangeSections}
      onAppendFindingToReport={onAppendFindingToReport}
      onApprove={onApprove}
      allStudies={allStudies}
    />
  );
}

