import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { isValidIdentifier, isPathInside } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  if (!isValidIdentifier(jobId)) {
    return NextResponse.json({ error: "Invalid jobId parameter" }, { status: 400 });
  }

  // Handle cached jobId shorthand
  if (jobId.startsWith("cached-")) {
    const studyId = jobId.replace("cached-", "");
    if (isValidIdentifier(studyId)) {
      const manifestPath = path.join(process.cwd(), ".scanlab", "derived", studyId, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const result = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          return NextResponse.json({
            jobId,
            studyId,
            status: "completed",
            progress: 100,
            stage: "finished",
            result,
          });
        } catch (err) {}
      }
    }
  }

  const jobsDir = path.join(process.cwd(), ".scanlab", "derived", ".jobs");
  const jobFile = path.join(jobsDir, `${jobId}.json`);

  if (!isPathInside(jobFile, jobsDir) || !fs.existsSync(jobFile)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const jobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    return NextResponse.json(jobData);
  } catch (error) {
    return NextResponse.json({ error: "Failed to read job record" }, { status: 500 });
  }
}
