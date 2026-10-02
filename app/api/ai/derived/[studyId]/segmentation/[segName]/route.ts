import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { isValidIdentifier, isPathInside } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studyId: string; segName: string }> }
) {
  const { studyId, segName } = await params;

  if (!studyId || !segName) {
    return NextResponse.json({ error: "Missing studyId or segName" }, { status: 400 });
  }

  if (!isValidIdentifier(studyId) || !isValidIdentifier(segName)) {
    return NextResponse.json({ error: "Invalid studyId or segName parameter" }, { status: 400 });
  }

  const segDir = path.join(process.cwd(), ".scanlab", "derived", studyId, "segmentation");
  const segPath = path.join(segDir, segName);

  if (!isPathInside(segPath, segDir) || !fs.existsSync(segPath)) {
    return NextResponse.json({ error: "Segmentation file not found" }, { status: 404 });
  }

  const stat = fs.statSync(segPath);
  const fileBuffer = fs.readFileSync(segPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${segName}"`,
      "Cache-Control": "public, max-age=86400",
      ETag: `"${studyId}-${segName}-${stat.mtimeMs}"`,
    },
  });
}
