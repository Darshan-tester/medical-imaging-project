import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { mirrorKeys, serveMirroredJson } from "@/lib/dataset/mirror";

export const dynamic = "force-dynamic";

/* `params` is a Promise from Next.js 15 onward — see the note in ../route.ts. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Mirrored for every indexed study, not just the ones whose pixels were
  // exported: report text is a few hundred bytes and comes verbatim out of the
  // manifest, so a study can have its real report on the deployed site even
  // when its images were left out of the pixel mirror.
  const mirrored = await serveMirroredJson(mirrorKeys.report(id), req);
  if (mirrored) return mirrored;

  const manifest = readManifest();
  const ds = manifest?.studies.find((s) => s.id === id);
  if (!ds) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  if (!ds.report) {
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({ available: true, report: ds.report });
}
