import { NextResponse } from "next/server";
import { getManifestStatus } from "@/lib/dataset/manifest-store";
export const dynamic = "force-dynamic";

/**
 * Reports on the index the app is actually serving, so a stale or missing
 * `.scanlab/manifest.json` shows up as an explicit banner instead of silently
 * looking like "this dataset has no reports".
 */
export async function GET(req: Request) {
  return NextResponse.json(getManifestStatus());
}
