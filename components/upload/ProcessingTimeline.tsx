"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = ["Upload", "Validating", "Preprocessing", "AI Analysis", "Findings", "Report Draft"];
const STAGE_DURATIONS = [700, 900, 1400, 1900, 800, 700];

export function ProcessingTimeline({ onComplete }: { onComplete: () => void }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (stageIndex >= STAGES.length) {
      onComplete();
      return;
    }
    const duration = STAGE_DURATIONS[stageIndex];
    setProgress(0);
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const elapsed = t - start;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setProgress(pct);
      if (pct < 100) raf = requestAnimationFrame(tick);
      else setStageIndex((i) => i + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIndex]);

  return (
    <div className="rounded-xl border border-border bg-panel p-6">
      <h3 className="text-card-title text-ink-primary">Processing your scan</h3>
      <p className="mt-1 text-[12.5px] text-ink-secondary">This won&apos;t take long — you can leave this page and check back from the Studies list.</p>

      <div className="mt-6 space-y-1">
        {STAGES.map((stage, i) => {
          const done = i < stageIndex;
          const active = i === stageIndex;
          return (
            <div key={stage} className="flex items-center gap-3 py-2">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                  done && "border-success bg-success text-canvas",
                  active && "border-clinical bg-clinical-dim text-clinical-strong",
                  !done && !active && "border-border-strong text-ink-muted"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
              </div>
              <span className={cn("flex-1 text-[13px]", done || active ? "text-ink-primary" : "text-ink-muted")}>{stage}</span>
              {active && (
                <div className="h-1 w-28 overflow-hidden rounded-full bg-[rgb(var(--overlay-hover)/0.1)]">
                  <div className="h-full rounded-full bg-clinical transition-[width] duration-100" style={{ width: `${progress}%` }} />
                </div>
              )}
              {done && <span className="text-[11px] text-success">Complete</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
