"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Activity, LayoutList, FileText, Loader2, type LucideIcon } from "lucide-react";
import { fetchStudy, fetchStudies } from "@/lib/data-source";
import { Finding, ReportSection, Study } from "@/lib/types";
import { ModalityBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/EmptyState";
import { OverviewTab } from "@/components/report/OverviewTab";
import { AnalysisTab } from "@/components/report/AnalysisTab";
import { ReportTab } from "@/components/report/ReportTab";
import { cn } from "@/lib/utils";
import { useUIStore, useAuthStore } from "@/lib/store";
import { SessionAnnotationStore } from "@/lib/annotation-store";
import { AuditTrail } from "@/lib/audit-trail";

type Tab = "overview" | "analysis" | "report";

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "analysis", label: "Viewer & AI Analysis", icon: Activity },
  { key: "report", label: "Report", icon: FileText },
];

const VALID_TABS: Tab[] = ["overview", "analysis", "report"];

export default function StudyWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [study, setStudy] = useState<Study | undefined>(undefined);
  const [allStudies, setAllStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Supports deep-linking straight into the viewer, e.g. "View Scan" from the
  // studies list/table links to `?tab=analysis`.
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(VALID_TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : "overview");
  const pushToast = useUIStore((s) => s.pushToast);
  const { user } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([fetchStudy(params.id), fetchStudies().catch(() => [])])
      .then(([s, all]) => {
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
        setAllStudies(all);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load study");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (VALID_TABS.includes(requestedTab as Tab)) setTab(requestedTab as Tab);
    // Only react to the URL changing (e.g. a fresh "View Scan" navigation) — not to `tab` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState title="Unable to load this study" description={loadError} action={{ label: "Retry", onClick: () => router.refresh() }} />
      </div>
    );
  }

  if (!study) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState
          title="Study not found"
          description="This study may have been removed, or the link is incorrect."
          action={{ label: "Back to Studies", onClick: () => router.push("/studies") }}
        />
      </div>
    );
  }

  const onUpdateFinding = (id: string, patch: Partial<Finding>) => {
    setStudy((prev) => (prev ? { ...prev, findings: prev.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) } : prev));
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

  // Appends a radiologist-authored finding (from a pen annotation) into the
  // report's Findings section. Always appends — never overwrites or rewrites
  // whatever the radiologist has already written; the exact text they typed
  // is preserved verbatim.
  const onAppendFindingToReport = (text: string) => {
    setStudy((prev) => {
      if (!prev) return prev;
      const existing = prev.report.sections.findings.trimEnd();
      const block = `Radiologist observation:\n${text}`;
      const findings = existing.length > 0 ? `${existing}\n\n${block}` : block;
      return { ...prev, report: { ...prev.report, sections: { ...prev.report.sections, findings } } };
    });
    pushToast({ title: "Added to report", description: "Your finding was appended to the Findings section.", tone: "success" });
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
    pushToast({ title: "Report approved", description: `${study.studyId} has been signed and finalized by ${user.name}.`, tone: "success" });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border bg-base px-4 py-3.5 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => router.push("/studies")} className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary hover:text-ink-primary">
            <ArrowLeft className="h-3.5 w-3.5" /> Studies
          </button>
          <span className="text-ink-muted">/</span>
          <span className="font-mono text-[12.5px] text-ink-primary">{study.studyId}</span>

          <div className="ml-auto flex items-center gap-2">
            <ModalityBadge modality={study.modality} />
            <PriorityBadge priority={study.priority} />
            <StatusBadge status={study.status} />
          </div>
        </div>

        <div>
          <h1 className="text-[19px] font-semibold text-ink-primary">{study.patientAlias}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            {[study.age !== undefined ? `${study.age}y` : undefined, study.sex, study.bodyRegion, study.modality].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors",
                  tab === t.key ? "border-clinical text-ink-primary" : "border-transparent text-ink-secondary hover:text-ink-primary"
                )}
              >
                <Icon className="h-[15px] w-[15px]" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && <OverviewTab study={study} onOpenViewer={() => setTab("analysis")} />}
        {tab === "analysis" && (
          <AnalysisTab
            study={study}
            allStudies={allStudies}
            onUpdateFinding={onUpdateFinding}
            onAppendFindingToReport={onAppendFindingToReport}
            onOpenReportTab={() => setTab("report")}
          />
        )}
        {tab === "report" && <ReportTab study={study} onChangeSections={onChangeSections} onApprove={onApprove} />}
      </div>
    </div>
  );
}
