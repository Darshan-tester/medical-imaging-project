import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudy } from "@/lib/dataset/to-app-study";
export const dynamic = "force-dynamic";

/*
 * `params` is a Promise from Next.js 15 onward (it was a plain object in 14).
 * The generated route validators in `.next/types` enforce this, so the old
 * synchronous signature fails the build rather than just warning.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const manifest = readManifest();
  const ds = manifest?.studies.find((s) => s.id === id);
  if (!ds) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  return NextResponse.json(toAppStudy(ds));
}
