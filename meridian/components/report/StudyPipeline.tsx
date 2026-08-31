import { Check } from "lucide-react";
import { StudyStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGES: { key: StudyStatus | "uploaded"; label: string }[] = [
  { key: "uploaded", label: "Upload" },
  { key: "queued", label: "Validating" },
  { key: "processing", label: "Preprocessing" },
  { key: "ai-complete", label: "AI Analysis" },
  { key: "in-review", label: "Findings Review" },
  { key: "approved", label: "Report Approved" },
];

const STAGE_ORDER: (StudyStatus | "uploaded")[] = ["uploaded", "queued", "processing", "ai-complete", "in-review", "approved"];

export function StudyPipeline({ status }: { status: StudyStatus }) {
  const currentIndex = STAGE_ORDER.indexOf(status);

  return (
    <div className="flex items-center overflow-x-auto px-1 py-1">
      {STAGES.map((stage, i) => {
        const done = i < currentIndex || status === "approved";
        const active = i === currentIndex && status !== "approved";
        return (
          <div key={stage.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold",
                  done && "border-success bg-success text-canvas",
                  active && "border-clinical bg-clinical-dim text-clinical-strong animate-pulse",
                  !done && !active && "border-border-strong text-ink-muted"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn("whitespace-nowrap text-[10.5px]", done || active ? "text-ink-secondary" : "text-ink-muted")}>{stage.label}</span>
            </div>
            {i < STAGES.length - 1 && <div className={cn("mx-1.5 h-px flex-1", done ? "bg-success/50" : "bg-border-strong")} />}
          </div>
        );
      })}
    </div>
  );
}
