/**
 * ---------------------------------------------------------------------------
 * DEMO INDEX LOADING
 * ---------------------------------------------------------------------------
 * Reads `public/demo-data/index.json` and hands back the same
 * `Study` objects the manifest-backed API routes return, so the studies list and
 * the viewer are looking at the real committed datasets through the existing
 * `toAppStudy` / `toAppStudySummary` conversion.
 *
 * The index is fetched, not imported. Importing it would inline ~1 MB of JSON
 * into the client bundle for every route, including the ones that never look at
 * a study; fetching it means the browser caches it as a static asset and the
 * whole thing is one request that the Worker serves without executing anything.
 *
 * Works on both sides: during a server render (a Cloudflare Worker request)
 * `fetch` resolves the asset over the same origin; in the browser it is an
 * ordinary cached GET. Nothing here touches `fs`.
 * ---------------------------------------------------------------------------
 */

import { Study } from "../types";
import { DatasetStudy } from "../dataset/types";
import { toAppStudy, toAppStudySummary } from "../dataset/to-app-study";
import { ctPerfIndex } from "../viewer/perf";
import { demoIndexToDatasetStudies } from "./expand";
import { registerStudyVolumes } from "./registry";
import { DEMO_INDEX_URL, DEMO_INDEX_VERSION, DemoIndex, DemoOmission } from "./types";

export interface DemoData {
  studies: DatasetStudy[];
  omitted: DemoOmission[];
  generatedAt: string;
}

const EMPTY: DemoData = { studies: [], omitted: [], generatedAt: "" };

/**
 * One in-flight load shared by every caller.
 *
 * The studies page, the study detail route and the thumbnails all want the index
 * on first paint; without this they would each start their own fetch of the same
 * asset.
 */
let pending: Promise<DemoData> | undefined;

function isDemoIndex(value: unknown): value is DemoIndex {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DemoIndex>;
  return v.version === DEMO_INDEX_VERSION && Array.isArray(v.studies);
}

/**
 * Absolute URL for the index.
 *
 * A relative path is enough in the browser but not during a server render, where
 * there is no document base. `NEXT_PUBLIC_SITE_URL` is used when set; otherwise
 * the relative path is returned and a server-side load simply comes back empty,
 * which degrades to the client fetching it on hydration rather than to an error.
 */
function indexUrl(): string {
  if (typeof window !== "undefined") return DEMO_INDEX_URL;
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return base ? `${base}${DEMO_INDEX_URL}` : DEMO_INDEX_URL;
}

async function fetchDemoIndex(): Promise<DemoData> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await fetch(indexUrl(), { cache: "force-cache" });
    if (!res.ok) return EMPTY;

    const raw: unknown = await res.json();
    if (!isDemoIndex(raw)) {
      // A version this build does not understand. Rendering half a study from
      // fields that have moved would be worse than showing none.
      return EMPTY;
    }

    // Volume geometry has to be registered before any slice URL derived from it
    // is fetched, which is why this happens here and not lazily in the decoder.
    for (const study of raw.studies) registerStudyVolumes(study);

    const studies = demoIndexToDatasetStudies(raw);

    /*
     * This one fetch is the entire metadata step: it carries every study, every
     * series and every slice URL already in order, so opening a study reads no
     * DICOM to find out what it contains. Timed here — dev only — because that
     * claim is worth being able to check.
     */
    ctPerfIndex({
      studies: studies.length,
      ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - started,
    });

    return {
      studies,
      omitted: raw.omitted ?? [],
      generatedAt: raw.generatedAt,
    };
  } catch {
    return EMPTY;
  }
}

export function loadDemoData(): Promise<DemoData> {
  pending ??= fetchDemoIndex();
  return pending;
}

/** Summaries for the studies list — the light projection, without per-slice URLs or report prose. */
export async function listDemoStudies(): Promise<Study[]> {
  const { studies } = await loadDemoData();
  return studies.map(toAppStudySummary);
}

/** The full study for the viewer and report tabs. */
export async function getDemoStudy(id: string): Promise<Study | undefined> {
  const { studies } = await loadDemoData();
  const match = studies.find((s) => s.id === id);
  return match ? toAppStudy(match) : undefined;
}

export async function getDemoOmissions(): Promise<DemoOmission[]> {
  const { omitted } = await loadDemoData();
  return omitted;
}
