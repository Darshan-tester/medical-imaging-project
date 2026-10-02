import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudySummary } from "@/lib/dataset/to-app-study";
import { mirrorKeys, serveMirroredJson } from "@/lib/dataset/mirror";
import { Study } from "@/lib/types";

export const dynamic = "force-dynamic";

let cachedStudies: { key: string; studies: Study[] } | undefined;

export async function GET(req: Request) {
  // On Workers this body was computed by `npm run mirror:export` from the same
  // `toAppStudySummary` below, so the two cannot drift. Streamed, never parsed:
  // the 5.5 MB manifest is what does not fit the Free plan's 10 ms CPU budget.
  const mirrored = await serveMirroredJson(mirrorKeys.studies(), req);
  if (mirrored) return mirrored;

  const manifest = readManifest();
  if (!manifest) {
    // No manifest yet — the UI must show "No indexed studies available.",
    // never fall back to fabricated placeholders. `/api/datasets/status`
    // tells the UI whether that means "not indexed" or "index unreadable".
    return NextResponse.json([]);
  }

  const cacheKey = `${manifest.generatedAt}::${manifest.studies.length}`;
  if (cachedStudies && cachedStudies.key === cacheKey) {
    return NextResponse.json(cachedStudies.studies);
  }

  // Summary projection, not the full study: the list renders no per-slice
  // detail, and a volumetric dataset has hundreds of thousands of slices.
  const studies = manifest.studies.map(toAppStudySummary);
  cachedStudies = { key: cacheKey, studies };
  return NextResponse.json(studies);
}

