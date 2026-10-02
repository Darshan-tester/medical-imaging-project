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
    const { currentStudyId, priorStudyId } = body;

    if (!currentStudyId || !priorStudyId) {
      return NextResponse.json({ error: "Missing currentStudyId or priorStudyId" }, { status: 400 });
    }

    if (!isValidIdentifier(currentStudyId) || !isValidIdentifier(priorStudyId)) {
      return NextResponse.json({ error: "Invalid study ID parameter" }, { status: 400 });
    }

    const manifest = readManifest();
    const currentStudy = manifest?.studies.find((s) => s.id === currentStudyId);
    const priorStudy = manifest?.studies.find((s) => s.id === priorStudyId);

    if (!currentStudy || !priorStudy) {
      return NextResponse.json({ error: "One or both studies not found in manifest" }, { status: 404 });
    }

    // Check if registration report already exists
    const regReportPath = path.join(
      process.cwd(),
      ".scanlab",
      "derived",
      currentStudyId,
      "registration",
      "registration_report.json"
    );

    if (fs.existsSync(regReportPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(regReportPath, "utf-8"));
        return NextResponse.json({ success: true, cached: true, ...cached });
      } catch (err) {}
    }

    // Resolve files
    const currFiles: string[] =
      Object.values(currentStudy.volumes || {})[0]?.files ||
      currentStudy.series[0]?.images?.map((i) => i.absPath).filter((p): p is string => Boolean(p)) ||
      [];

    const priorFiles: string[] =
      Object.values(priorStudy.volumes || {})[0]?.files ||
      priorStudy.series[0]?.images?.map((i) => i.absPath).filter((p): p is string => Boolean(p)) ||
      [];

    if (!currFiles.length || !priorFiles.length) {
      return NextResponse.json(
        {
          status: "FAILED",
          code: "INSUFFICIENT_FILES",
          message: "Could not resolve physical volume files for current or prior study.",
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
      "registration",
      "--study",
      currentStudyId,
      "--prior-study",
      priorStudyId,
      "--files",
      ...currFiles.slice(0, 100), // Use sampled slices for quick registration
      "--prior-files",
      ...priorFiles.slice(0, 100),
    ];

    const { stdout } = await execFileAsync(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
      timeout: 60000,
    });

    const result = parsePythonJson(stdout);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { status: "FAILED", message: error instanceof Error ? error.message : "Registration pipeline error" },
      { status: 500 }
    );
  }
}
