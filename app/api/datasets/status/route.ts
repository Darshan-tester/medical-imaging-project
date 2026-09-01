import { NextResponse } from "next/server";
import { getManifestStatus } from "@/lib/dataset/manifest-store";

export const dynamic = "force-dynamic";

/**
 * Reports on the index the app is actually serving, so a stale or missing
 * `.scanlab/manifest.json` shows up as an explicit banner instead of silently
 * looking like "this dataset has no reports".
 *
 * Deliberately does not include `scanRoot` — SCANLAB_DATA_ROOT never leaves
 * the server.
 */
export async function GET() {
  return NextResponse.json(getManifestStatus());
}
