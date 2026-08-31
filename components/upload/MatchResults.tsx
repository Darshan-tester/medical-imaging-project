"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSearch, FileText, Fingerprint, Tag } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ModalityBadge } from "@/components/ui/Badge";
import type { UploadMatchResult } from "@/lib/data-source";
import type { Modality } from "@/lib/types";

/**
 * Renders the outcome of hashing uploaded files against the indexed dataset.
 *
 * Deliberately plain about what a match is: a lookup that found the study the
 * file came from. There is no confidence number, no finding count and no AI
 * badge anywhere in here, because nothing in this path runs a model — inventing
 * any of those over a real patient image is the failure this flow replaced.
 */
export function MatchResults({ results, onReset }: { results: UploadMatchResult[]; onReset: () => void }) {
  const matched = results.filter((r) => r.outcome.status === "matched");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
            <FileSearch className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h3 className="text-card-title text-ink-primary">
              {matched.length} of {results.length} file{results.length !== 1 ? "s" : ""} matched to an indexed study
            </h3>
            <p className="text-[12px] text-ink-secondary">Reference record from the source dataset — not an AI prediction.</p>
          </div>
        </div>
      </div>

      {results.map((result) => (
        <ResultCard key={`${result.fileName}-${result.sha256}`} result={result} />
      ))}

      <Button variant="secondary" size="md" className="w-full" onClick={onReset}>
        Upload Another
      </Button>
    </div>
  );
}

function ResultCard({ result }: { result: UploadMatchResult }) {
  const { outcome } = result;

  if (outcome.status !== "matched") {
    const critical = outcome.status === "stale";
    return (
      <div className={`rounded-xl border bg-panel p-5 ${critical ? "border-critical/30" : "border-warning/30"}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${critical ? "text-critical" : "text-warning"}`} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink-primary">{result.fileName}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{outcome.reason}</p>
            <p className="mt-2 font-mono text-[10.5px] text-ink-muted">sha256 {result.sha256.slice(0, 16)}…</p>
          </div>
        </div>
      </div>
    );
  }

  const { match } = outcome;
  return (
    <div className="rounded-xl border border-success/30 bg-panel p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-primary">{result.fileName}</p>
          <p className="mt-1 text-[12.5px] text-ink-secondary">
            {match.studyCode} · {match.patientAlias}
            {match.bodyRegion ? ` · ${match.bodyRegion}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ModalityBadge modality={match.modality as Modality} />
            <Chip icon={match.matchedBy === "content" ? <Fingerprint className="h-3 w-3" /> : <Tag className="h-3 w-3" />}>
              {match.matchedBy === "content" ? "Matched by file content" : "Matched by study code in filename"}
            </Chip>
            <Chip icon={<FileText className="h-3 w-3" />}>{match.hasReport ? "Dataset report available" : "No report in source data"}</Chip>
          </div>

          <p className="mt-3 text-[12px] text-ink-secondary">
            {match.datasetLabel} · {match.seriesCount} series
            {match.sourceLabel ? ` · exported from ${match.sourceLabel}` : ""}
          </p>

          <Link href={`/studies/${match.studyId}`} className="mt-4 inline-block">
            <Button variant="primary" size="md">
              Open {match.studyCode}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-panel-alt px-1.5 py-0.5 text-[10.5px] text-ink-secondary">
      {icon}
      {children}
    </span>
  );
}
