import { cn } from "@/lib/utils";
import { AIConfidenceBand, IncidentSeverity, IncidentStatus, Modality, StudyPriority, StudyStatus } from "@/lib/types";
import { Activity, AlertTriangle, CheckCircle2, Clock, FileClock, Loader2, type LucideIcon } from "lucide-react";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "clinical" | "ai" | "success" | "warning" | "critical";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[rgb(var(--overlay-hover)/0.06)] text-ink-secondary border-border-strong",
    clinical: "bg-clinical-dim text-clinical-strong border-clinical/30",
    ai: "bg-ai-dim text-ai-strong border-ai/30",
    success: "bg-success-dim text-success border-success/30",
    warning: "bg-warning-dim text-warning border-warning/30",
    critical: "bg-critical-dim text-critical border-critical/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-normal tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const MODALITY_LABEL: Record<Modality, string> = {
  CT: "CT",
  MRI: "MRI",
  "X-Ray": "X-Ray",
  Ultrasound: "US",
  PET: "PET",
  Mammography: "Mammo",
};

export function ModalityBadge({ modality }: { modality: Modality }) {
  return (
    <Badge tone="clinical" className="font-mono">
      {MODALITY_LABEL[modality]}
    </Badge>
  );
}

const STATUS_CONFIG: Record<StudyStatus, { label: string; tone: "neutral" | "clinical" | "ai" | "success" | "warning"; icon: LucideIcon }> = {
  queued: { label: "Queued", tone: "neutral", icon: Clock },
  processing: { label: "Processing", tone: "ai", icon: Loader2 },
  "ai-complete": { label: "AI Complete", tone: "clinical", icon: Activity },
  "in-review": { label: "In Review", tone: "warning", icon: FileClock },
  approved: { label: "Approved", tone: "success", icon: CheckCircle2 },
};

export function StatusBadge({ status }: { status: StudyStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone}>
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} strokeWidth={2.25} />
      {cfg.label}
    </Badge>
  );
}

const PRIORITY_CONFIG: Record<StudyPriority, { label: string; tone: "neutral" | "warning" | "critical" }> = {
  routine: { label: "Routine", tone: "neutral" },
  urgent: { label: "Urgent", tone: "warning" },
  stat: { label: "STAT", tone: "critical" },
};

export function PriorityBadge({ priority }: { priority: StudyPriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <Badge tone={cfg.tone}>
      {priority === "stat" && <AlertTriangle className="h-3 w-3" strokeWidth={2.25} />}
      {cfg.label}
    </Badge>
  );
}

const INCIDENT_SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; tone: "neutral" | "warning" | "critical" }> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "warning" },
  critical: { label: "Critical", tone: "critical" },
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const cfg = INCIDENT_SEVERITY_CONFIG[severity];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

const INCIDENT_STATUS_CONFIG: Record<IncidentStatus, { label: string; tone: "neutral" | "warning" | "success" }> = {
  open: { label: "Open", tone: "warning" },
  "under-review": { label: "Under Review", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const cfg = INCIDENT_STATUS_CONFIG[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

export function DatasetSourceBadge({ source }: { source: string }) {
  return (
    <Badge tone="neutral" className="font-mono">
      {source}
    </Badge>
  );
}

export function ConfidenceBand({ band }: { band: AIConfidenceBand }) {
  const label = band === "high" ? "High confidence" : band === "moderate" ? "Moderate confidence" : "Low confidence";
  const tone = band === "high" ? "success" : band === "moderate" ? "warning" : "critical";
  return <Badge tone={tone}>{label}</Badge>;
}
