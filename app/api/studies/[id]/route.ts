import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudy } from "@/lib/dataset/to-app-study";
import { mirrorKeys, serveMirroredJson } from "@/lib/dataset/mirror";

export const dynamic = "force-dynamic";

/*
 * `params` is a Promise from Next.js 15 onward (it was a plain object in 14).
 * The generated route validators in `.next/types` enforce this, so the old
 * synchronous signature fails the build rather than just warning.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Precomputed by `npm run mirror:export` using the same `toAppStudy` below.
  // Also removes the per-request `parseReportSections` and the expansion of
  // frame runs into per-slice URLs (up to 558 entries for the CT axial series).
  const mirrored = await serveMirroredJson(mirrorKeys.study(id), req);
  if (mirrored) return mirrored;

  const manifest = readManifest();
  const ds = manifest?.studies.find((s) => s.id === id);
  if (!ds) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  return NextResponse.json(toAppStudy(ds));
}
