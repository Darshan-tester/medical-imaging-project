import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

import { isValidIdentifier, parsePythonJson } from "@/lib/ai-security";

const execFileAsync = promisify(execFile);
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { studyId, seriesId } = body;

    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid or missing studyId" }, { status: 400 });
    }

    if (seriesId && !isValidIdentifier(seriesId)) {
      return NextResponse.json({ error: "Invalid seriesId" }, { status: 400 });
    }

    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Check if motion report already exists
    const motionReportPath = path.join(
      process.cwd(),
      ".scanlab",
      "derived",
      studyId,
      "motion",
      "motion_report.json"
    );

    if (fs.existsSync(motionReportPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(motionReportPath, "utf-8"));
        return NextResponse.json({ success: true, cached: true, ...cached });
      } catch (err) {}
    }

    // Determine files
    const targetSeries = seriesId
      ? study.series.find((s) => s.id === seriesId) || study.series[0]
      : study.series[0];

    const volumeId = targetSeries?.volumeId || Object.keys(study.volumes || {})[0];
    const files = volumeId && study.volumes?.[volumeId]
      ? study.volumes[volumeId].files
      : targetSeries?.images?.map((i) => i.absPath).filter((p): p is string => Boolean(p)) || [];

    if (!files.length) {
      return NextResponse.json(
        {
          status: "UNSUPPORTED",
          code: "NO_VOLUMETRIC_DATA",
          message: "No volumetric imaging found for motion analysis.",
        },
        { status: 422 }
      );
    }

    // Call Python worker
    const venvPython = path.join(process.cwd(), "services", "ai_worker", ".venv", "Scripts", "python.exe");
    const pythonExe = fs.existsSync(venvPython)
      ? venvPython
      : "C:\\Users\\QUIKCARE COMPUTERS\\AppData\\Local\\Programs\\Python\\Python310\\python.exe";

    const args = [
      "-m",
      "services.ai_worker.worker",
      "--pipeline",
      "motion",
      "--study",
      studyId,
      "--series",
      targetSeries?.id || "",
      "--files",
      ...files.slice(0, 30),
    ];

    const { stdout } = await execFileAsync(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
      timeout: 60000,
    });

    const result = parsePythonJson(stdout);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Motion pipeline error:", error);
    return NextResponse.json(
      {
        status: "UNSUPPORTED",
        code: "PIPELINE_ERROR",
        message: error instanceof Error ? error.message : "4D motion pipeline error",
      },
      { status: 500 }
    );
  }
}
