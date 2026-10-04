"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { fetchIndexStatus, IndexStatus } from "@/lib/data-source";
import { cn } from "@/lib/utils";

/**
 * Surfaces the state of `.scanlab/manifest.json` — the file every dataset view
 * is actually served from.
 *
 * Without this, an index built before an adapter fix is indistinguishable from
 * a dataset that genuinely has no reports: the studies load, the images load,
 * and the report panel just says "not available". The banner names the real
 * cause and the exact command that fixes it, and stays out of the way once the
 * index is current.
 */
export function IndexStatusBanner() {
  const [status, setStatus] = useState<IndexStatus | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetchIndexStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* Status is advisory only — never block the studies list on it. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.state === "current") return null;

  const critical = status.state === "unreadable";

  return (
    <div
      role="status"
      className={cn(
        "mt-5 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:gap-4",
        critical ? "border-critical/40 bg-critical-dim" : "border-warning/40 bg-warning-dim"
      )}
    >
      <div className={cn("mt-0.5 shrink-0", critical ? "text-critical-strong" : "text-warning-strong")}>
        {status.state === "missing" ? <Database className="h-5 w-5" aria-hidden /> : <AlertTriangle className="h-5 w-5" aria-hidden />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink-primary">
          {status.state === "stale"
            ? "This page is showing an out-of-date dataset index"
            : status.state === "missing"
              ? "No dataset index has been built yet"
              : "The dataset index could not be read"}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{status.message}</p>

        {status.state === "stale" && status.generatedAt && (
          <p className="mt-1.5 text-meta text-ink-muted">
            Indexed {new Date(status.generatedAt).toLocaleString()} · {status.studies.toLocaleString()} studies ·{" "}
            {status.reports.toLocaleString()} with a matched report
          </p>
        )}

        {status.error && <p className="mt-1.5 break-words font-mono text-meta text-ink-muted">{status.error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-meta font-medium text-ink-primary transition-colors hover:bg-panel-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh Archive
          </button>
          {status.remedy && (
            <details className="text-[11px] text-ink-muted cursor-pointer">
              <summary className="hover:text-ink-secondary">PACS Administrator Info</summary>
              <div className="mt-1.5 p-2 rounded bg-panel-alt border border-border font-mono text-[10.5px]">
                <code>{status.remedy}</code>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
