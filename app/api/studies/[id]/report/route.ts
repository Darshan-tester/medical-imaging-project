import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";

export const dynamic = "force-dynamic";

/* `params` is a Promise from Next.js 15 onward — see the note in ../route.ts. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
