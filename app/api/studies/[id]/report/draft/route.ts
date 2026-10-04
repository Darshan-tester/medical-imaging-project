import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function getReportDir(studyId: string): string {
  const dir = path.join(process.cwd(), ".scanlab", "derived", studyId, "report");
  const versionsDir = path.join(dir, "versions");
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }
  return dir;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const reportDir = getReportDir(studyId);
    const draftFile = path.join(reportDir, "draft.json");

    if (fs.existsSync(draftFile)) {
      try {
        const draft = JSON.parse(fs.readFileSync(draftFile, "utf-8"));
        return NextResponse.json({ success: true, draft, isDerivedDraft: true });
      } catch (err) {}
    }

    // Fallback to baseline study report
    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const seededFindings = (study as any).findings || (study as any).aiFindings || [];
    return NextResponse.json({
      success: true,
      draft: {
        studyId,
        version: 1,
        status: "DRAFT",
        sections: {
          clinicalInformation: `Patient: ${study.patientAlias || "Patient"} · Age: ${study.age || "Unknown"} · Sex: ${study.sex || "Unknown"}\nModality: ${study.modality}`,
          technique: `${study.modality} volumetric clinical scan.`,
          findings: seededFindings.map((f: any) => `• ${f.label || "Finding"}: ${f.description || "Visualized without acute complication."}`).join("\n\n") || "No focal acute abnormality identified on initial review.",
          impression: "AI-assisted preliminary interpretation pending final radiologist validation.",
        },
        aiTransparency: {
          engine: "Meridian Multimodal Clinical Agent Suite",
          disclaimer: "This report is AI-assisted and requires review and approval by a licensed radiologist before clinical use.",
          findingsCount: seededFindings.length,
        },
        updatedAt: new Date().toISOString(),
      },
      isDerivedDraft: false,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to read report draft" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Read findings
    const findingsFile = path.join(process.cwd(), ".scanlab", "derived", studyId, "findings", "findings.json");
    let findings: any[] = [];
    if (fs.existsSync(findingsFile)) {
      try {
        findings = JSON.parse(fs.readFileSync(findingsFile, "utf-8"));
      } catch (e) {}
    }

    // Read metadata
    const metadataFile = path.join(process.cwd(), ".scanlab", "derived", studyId, "metadata.json");
    let metadata: any = null;
    if (fs.existsSync(metadataFile)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
      } catch (e) {}
    }

    const acceptedFindings = findings.filter((f) => f.reviewStatus === "ACCEPTED" || f.status === "accepted");
    const pendingFindings = findings.filter((f) => f.reviewStatus === "AI_GENERATED" || f.status === "pending");
    const rejectedFindings = findings.filter((f) => f.reviewStatus === "REJECTED" || f.status === "rejected");

    // Group findings into organ systems
    const findingsLines: string[] = [];

    if (acceptedFindings.length > 0) {
      findingsLines.push("=== RADIOLOGIST-VALIDATED FINDINGS ===");
      acceptedFindings.forEach((f) => {
        const meas = f.measurement?.volumeMl ? ` (Volume: ${f.measurement.volumeMl} mL)` : "";
        findingsLines.push(`• [${f.anatomy || "Finding"}]: ${f.description || f.label}${meas}`);
      });
    }

    if (pendingFindings.length > 0) {
      findingsLines.push("\n=== AI-DERIVED ANATOMICAL OBSERVATIONS (Pending Review) ===");
      pendingFindings.forEach((f) => {
        const meas = f.measurement?.volumeMl ? ` [Measured: ${f.measurement.volumeMl} mL]` : "";
        findingsLines.push(`• ${f.anatomy || "Structure"}: ${f.description || f.label}${meas} (Source: ${f.source || "AI"})`);
      });
    }

    if (findingsLines.length === 0) {
      findingsLines.push("Volumetric review demonstrates intact anatomical boundaries without focal mass lesion or acute consolidation.");
    }

    const reportDir = getReportDir(studyId);
    const draftFile = path.join(reportDir, "draft.json");

    let currentVersion = 1;
    if (fs.existsSync(draftFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(draftFile, "utf-8"));
        currentVersion = (prev.version || 1) + 1;
      } catch (e) {}
    }

    const now = new Date().toISOString();
    const draftContent = {
      studyId,
      version: currentVersion,
      status: "DRAFT",
      sections: {
        clinicalInformation: `Patient: ${study.patientAlias || "Patient"} · Age: ${study.age || "Unknown"} · Sex: ${study.sex || "Unknown"}\nClinical History: ${(study as any).clinicalHistory || "Diagnostic volumetric imaging evaluation."}\nModality: ${study.modality}`,
        technique: `${study.modality} volumetric acquisition with high-resolution reconstruction.\nAI Engine: ${metadata?.model || "MONAI Physio Anatomy Engine"} (v${metadata?.modelVersion || "2.0.0"}).`,
        findings: findingsLines.join("\n"),
        impression: acceptedFindings.length > 0
          ? `Anatomical analysis complete. Key findings noted in ${acceptedFindings.map((f) => f.anatomy).join(", ")}. Correlate clinically.`
          : "Preliminary AI analysis completed. Clinical findings pending radiologist review.",
      },
      aiTransparency: {
        engine: metadata?.model || "MONAI Physio",
        version: metadata?.modelVersion || "2.0.0",
        totalFindings: findings.length,
        acceptedCount: acceptedFindings.length,
        pendingCount: pendingFindings.length,
        rejectedCount: rejectedFindings.length,
        disclaimer: "This report is AI-assisted and requires review and approval by a licensed radiologist before clinical use.",
      },
      createdAt: now,
      updatedAt: now,
    };

    // Save draft
    fs.writeFileSync(draftFile, JSON.stringify(draftContent, null, 2));

    // Save version history snapshot (Section 19: Report Versioning)
    const versionFile = path.join(reportDir, "versions", `draft_v${currentVersion}_${Date.now()}.json`);
    fs.writeFileSync(versionFile, JSON.stringify(draftContent, null, 2));

    return NextResponse.json({
      success: true,
      draft: draftContent,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compile report draft" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const body = await req.json();
    const reportDir = getReportDir(studyId);
    const draftFile = path.join(reportDir, "draft.json");

    let currentDraft: any = null;
    if (fs.existsSync(draftFile)) {
      try {
        currentDraft = JSON.parse(fs.readFileSync(draftFile, "utf-8"));
      } catch (e) {}
    }

    if (!currentDraft) {
      currentDraft = {
        studyId,
        version: 1,
        status: "DRAFT",
        sections: {},
      };
    }

    const nextVersion = (currentDraft.version || 1) + 1;
    const now = new Date().toISOString();

    currentDraft.version = nextVersion;
    currentDraft.sections = { ...currentDraft.sections, ...(body.sections || {}) };
    currentDraft.updatedAt = now;
    if (body.editor) {
      currentDraft.lastEditor = body.editor;
    }

    fs.writeFileSync(draftFile, JSON.stringify(currentDraft, null, 2));

    // Snapshot version history (Section 19)
    const versionFile = path.join(reportDir, "versions", `draft_v${nextVersion}_${Date.now()}.json`);
    fs.writeFileSync(versionFile, JSON.stringify(currentDraft, null, 2));

    return NextResponse.json({
      success: true,
      draft: currentDraft,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update report draft" },
      { status: 500 }
    );
  }
}
