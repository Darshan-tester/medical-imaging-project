import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { isValidIdentifier, isPathInside } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;

  if (!studyId) {
    return NextResponse.json({ error: "Missing studyId" }, { status: 400 });
  }

  if (!isValidIdentifier(studyId)) {
    return NextResponse.json({ error: "Invalid studyId parameter" }, { status: 400 });
  }

  const baseDerivedDir = path.join(process.cwd(), ".scanlab", "derived");
  const studyDerivedDir = path.join(baseDerivedDir, studyId);

  if (!isPathInside(studyDerivedDir, baseDerivedDir)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const manifestPath = path.join(studyDerivedDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({
      studyId,
      status: "not_processed",
      segments: [],
      meshes: [],
      metrics: {},
    });
  }

  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to read derived study manifest" }, { status: 500 });
  }
}
