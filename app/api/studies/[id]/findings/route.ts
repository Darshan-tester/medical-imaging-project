import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function getFindingsPath(studyId: string): string {
  return path.join(process.cwd(), ".scanlab", "derived", studyId, "findings", "findings.json");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const findingsFile = getFindingsPath(studyId);
    if (fs.existsSync(findingsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(findingsFile, "utf-8"));
        const list = Array.isArray(data) ? data : data.findings || [];
        return NextResponse.json(list);
      } catch (err) {}
    }

    // Fallback to manifest seeded findings if derived findings not yet generated
    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const seededList = (study as any).findings || (study as any).aiFindings || [];
    const fallbackFindings = seededList.map((f: any) => ({
      findingId: f.id,
      id: f.id,
      studyId,
      modality: study.modality,
      anatomy: f.label || "Anatomy",
      findingType: "Baseline Clinical Finding",
      description: f.description || "",
      label: f.label,
      location: f.location || "Reference Slice",
      measurement: f.measurements || {},
      confidence: f.confidence ? f.confidence / 100 : 0.9,
      band: f.band || "high",
      source: "BASELINE",
      reviewStatus: f.status === "accepted" ? "ACCEPTED" : "AI_GENERATED",
      status: f.status || "pending",
      radiologistAction: f.status === "accepted" ? "ACCEPTED" : null,
      radiologistComments: f.radiologistNote || "",
    }));

    return NextResponse.json(fallbackFindings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to read findings" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const body = await req.json();
    const findingsFile = getFindingsPath(studyId);
    const findingsDir = path.dirname(findingsFile);
    if (!fs.existsSync(findingsDir)) {
      fs.mkdirSync(findingsDir, { recursive: true });
    }

    let findings: any[] = [];
    if (fs.existsSync(findingsFile)) {
      try {
        findings = JSON.parse(fs.readFileSync(findingsFile, "utf-8"));
        if (!Array.isArray(findings)) findings = [];
      } catch (e) {
        findings = [];
      }
    }

    const now = new Date().toISOString();
    const findingId = body.findingId || body.id || `fnd-rad-${Date.now()}-${findings.length + 1}`;

    const newFinding = {
      findingId,
      id: findingId,
      studyId,
      modality: body.modality || "CT",
      anatomy: body.anatomy || body.label || "Radiologist Observation",
      findingType: body.findingType || "Clinical Observation",
      description: body.description || "",
      label: body.label || body.anatomy || "Finding",
      location: body.location || "Unspecified",
      measurement: body.measurement || body.measurements || {},
      confidence: 1.0,
      source: "RADIOLOGIST",
      reviewStatus: "ACCEPTED",
      status: "accepted",
      radiologistAction: "MANUAL_ENTRY",
      radiologistComments: body.radiologistComments || body.radiologistNote || "",
      createdAt: now,
      lastReviewedAt: now,
    };

    findings.push(newFinding);
    fs.writeFileSync(findingsFile, JSON.stringify(findings, null, 2));

    return NextResponse.json({
      success: true,
      finding: newFinding,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record finding" },
      { status: 500 }
    );
  }
}
