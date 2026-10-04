import { NextResponse } from "next/server";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function getFindingsPath(studyId: string): string {
  return path.join(process.cwd(), ".scanlab", "derived", studyId, "findings", "findings.json");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) {
  try {
    const { id: studyId, findingId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }
    if (!findingId || !isValidIdentifier(findingId)) {
      return NextResponse.json({ error: "Invalid findingId" }, { status: 400 });
    }

    const body = await req.json();
    const findingsFile = getFindingsPath(studyId);
    if (!fs.existsSync(findingsFile)) {
      return NextResponse.json({ error: "No findings record found for study" }, { status: 404 });
    }

    let findings: any[] = [];
    try {
      findings = JSON.parse(fs.readFileSync(findingsFile, "utf-8"));
      if (!Array.isArray(findings)) findings = [];
    } catch (e) {
      return NextResponse.json({ error: "Corrupted findings file" }, { status: 500 });
    }

    const target = findings.find((f) => f.findingId === findingId || f.id === findingId);
    if (!target) {
      return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Section 15 statuses: AI_GENERATED, RADIOLOGIST_REVIEWED, ACCEPTED, EDITED, REJECTED
    if (body.reviewStatus) {
      target.reviewStatus = body.reviewStatus;
      target.status = body.reviewStatus.toLowerCase();
      target.radiologistAction = body.reviewStatus;
    } else if (body.status) {
      target.status = body.status;
      target.reviewStatus = body.status.toUpperCase();
      target.radiologistAction = body.status.toUpperCase();
    }

    if (body.radiologistComments !== undefined) {
      target.radiologistComments = body.radiologistComments;
      target.radiologistNote = body.radiologistComments;
    }
    if (body.radiologistNote !== undefined) {
      target.radiologistComments = body.radiologistNote;
      target.radiologistNote = body.radiologistNote;
    }

    if (body.measurement) {
      target.measurement = { ...target.measurement, ...body.measurement };
    }
    if (body.description) {
      target.description = body.description;
    }

    target.lastReviewedAt = now;

    fs.writeFileSync(findingsFile, JSON.stringify(findings, null, 2));

    return NextResponse.json({
      success: true,
      finding: target,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update finding" },
      { status: 500 }
    );
  }
}
