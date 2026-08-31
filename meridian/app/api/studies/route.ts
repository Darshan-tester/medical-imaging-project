import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudy } from "@/lib/dataset/to-app-study";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = readManifest();
  if (!manifest) {
    // No manifest yet — the UI must show "No indexed studies available.",
    // never fall back to fabricated placeholders.
    return NextResponse.json([]);
  }
  const studies = manifest.studies.map(toAppStudy);
  return NextResponse.json(studies);
}
