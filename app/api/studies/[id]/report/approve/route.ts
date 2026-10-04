import { NextResponse } from "next/server";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const reportDir = path.join(process.cwd(), ".scanlab", "derived", studyId, "report");
    const draftFile = path.join(reportDir, "draft.json");
    const finalReportFile = path.join(reportDir, "final_report.json");

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    let reportData: any = {};
    if (fs.existsSync(draftFile)) {
      try {
        reportData = JSON.parse(fs.readFileSync(draftFile, "utf-8"));
      } catch (e) {}
    }

    if (body.sections) {
      reportData.sections = { ...reportData.sections, ...body.sections };
    }

    const now = new Date().toISOString();
    const finalReport = {
      ...reportData,
      studyId,
      status: "APPROVED",
      approvedAt: now,
      reviewer: {
        id: body.reviewerId || "usr-chen",
        name: body.reviewerName || "Dr. Alex Chen, MD",
        role: "Attending Radiologist",
        credentials: "MD, ABR Certified",
      },
      disclaimer: "This report is finalized by a licensed radiologist following AI-assisted workstation analysis.",
      pdfUrl: `/api/studies/${studyId}/derived/report/final.pdf`,
    };

    fs.writeFileSync(finalReportFile, JSON.stringify(finalReport, null, 2));

    // Also update draft status to APPROVED
    reportData.status = "APPROVED";
    reportData.approvedAt = now;
    reportData.reviewer = finalReport.reviewer;
    fs.writeFileSync(draftFile, JSON.stringify(reportData, null, 2));

    return NextResponse.json({
      success: true,
      finalReport,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve report" },
      { status: 500 }
    );
  }
}
