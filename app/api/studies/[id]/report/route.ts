import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const manifest = readManifest();
  const ds = manifest?.studies.find((s) => s.id === params.id);
  if (!ds) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  if (!ds.report) {
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({ available: true, report: ds.report });
}
