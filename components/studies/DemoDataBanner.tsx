"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { DATASET_SOURCE_LABEL } from "@/lib/dataset/types";
import { getDemoOmissions } from "@/lib/demo/load";
import { DemoOmission } from "@/lib/demo/types";

/**
 * States which committed studies are *not* in the deployed build, and why.
 *
 * The deployed corpus is not simply "everything under `public/demo-data`": two
 * MRI archives exceed Cloudflare's 25 MiB per-asset limit and are deliberately
 * not committed, so a build that silently listed 8 of 10 MRI studies would look
 * like a scan that missed two. `scripts/demo-index.ts` records each exclusion
 * with the measured reason at generation time (`DemoIndex.omitted`) and this
 * renders them verbatim.
 *
 * Renders nothing when the index omits nothing, so it disappears the moment the
 * corpus is whole — the same way `IndexStatusBanner` goes quiet once the
 * manifest is current.
 */
export function DemoDataBanner() {
  const [omitted, setOmitted] = useState<DemoOmission[]>([]);

  useEffect(() => {
    let cancelled = false;
    getDemoOmissions()
      .then((list) => {
        if (!cancelled) setOmitted(list);
      })
      .catch(() => {
        /* Advisory only — never block the studies list on it. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (omitted.length === 0) return null;

  return (
    <div role="status" className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-panel-alt p-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="mt-0.5 shrink-0 text-ink-muted">
        <Info className="h-5 w-5" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink-primary">
          {omitted.length === 1 ? "One study is not available in this build" : `${omitted.length} studies are not available in this build`}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
          Their reports are part of the dataset, but their images are not deployed, so they are left out of the list rather than shown as studies that cannot open.
        </p>

        <ul className="mt-2.5 space-y-1.5">
          {omitted.map((o) => (
            <li key={`${o.dataset}-${o.srcId}`} className="text-meta leading-relaxed text-ink-muted">
              <span className="font-mono text-ink-secondary">{o.srcId}</span>
              <span className="mx-1.5">·</span>
              <span>{DATASET_SOURCE_LABEL[o.dataset] ?? o.dataset}</span>
              <span className="mx-1.5">·</span>
              <span>{o.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
