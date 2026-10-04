import { NextResponse } from "next/server";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const finalReportFile = path.join(process.cwd(), ".scanlab", "derived", studyId, "report", "final_report.json");
    if (!fs.existsSync(finalReportFile)) {
      return NextResponse.json({ error: "Final report not yet approved" }, { status: 404 });
    }

    const data = JSON.parse(fs.readFileSync(finalReportFile, "utf-8"));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to read final report" }, { status: 500 });
  }
}
