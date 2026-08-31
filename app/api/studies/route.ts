import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudySummary } from "@/lib/dataset/to-app-study";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = readManifest();
  if (!manifest) {
    // No manifest yet — the UI must show "No indexed studies available.",
    // never fall back to fabricated placeholders. `/api/datasets/status`
    // tells the UI whether that means "not indexed" or "index unreadable".
    return NextResponse.json([]);
  }
  // Summary projection, not the full study: the list renders no per-slice
  // detail, and a volumetric dataset has hundreds of thousands of slices.
  const studies = manifest.studies.map(toAppStudySummary);
  return NextResponse.json(studies);
}
