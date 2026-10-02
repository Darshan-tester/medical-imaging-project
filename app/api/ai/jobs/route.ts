import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import { isValidIdentifier } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

function getPythonExecutable(): string {
  const venvPython = path.join(process.cwd(), "services", "ai_worker", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) return venvPython;
  const sysPython = "C:\\Users\\QUIKCARE COMPUTERS\\AppData\\Local\\Programs\\Python\\Python310\\python.exe";
  if (fs.existsSync(sysPython)) return sysPython;
  return "python";
}

function getJobsDir(): string {
  const jobsDir = path.join(process.cwd(), ".scanlab", "derived", ".jobs");
  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  return jobsDir;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { studyId, seriesId, pipeline = "segmentation", priorStudyId, findings } = body;

    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid or missing studyId parameter" }, { status: 400 });
    }

    if (seriesId && !isValidIdentifier(seriesId)) {
      return NextResponse.json({ error: "Invalid seriesId parameter" }, { status: 400 });
    }

    if (priorStudyId && !isValidIdentifier(priorStudyId)) {
      return NextResponse.json({ error: "Invalid priorStudyId parameter" }, { status: 400 });
    }

    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found in active manifest" }, { status: 404 });
    }

    // Check if output is already cached
    const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
    const studyManifestPath = path.join(derivedDir, "manifest.json");

    if (pipeline === "segmentation" && fs.existsSync(studyManifestPath)) {
      try {
        const cachedManifest = JSON.parse(fs.readFileSync(studyManifestPath, "utf-8"));
        if (cachedManifest.status === "completed") {
          return NextResponse.json({
            success: true,
            jobId: `cached-${studyId}`,
            status: "completed",
            progress: 100,
            stage: "cached_output_ready",
            cached: true,
            result: cachedManifest,
          });
        }
      } catch (e) {
        // proceed with fresh execution
      }
    }

    // Determine input files
    let inputFiles: string[] = [];
    const targetSeries = seriesId
      ? study.series.find((s) => s.id === seriesId) || study.series[0]
      : study.series[0];

    const volumeId = targetSeries?.volumeId || Object.keys(study.volumes || {})[0];
    if (volumeId && study.volumes?.[volumeId]) {
      inputFiles = study.volumes[volumeId].files || [];
    } else if (targetSeries?.images?.length) {
      inputFiles = targetSeries.images
        .map((img) => img.absPath)
        .filter((p): p is string => Boolean(p) && fs.existsSync(p));
    }

    let priorFiles: string[] = [];
    if (priorStudyId) {
      const priorStudy = manifest?.studies.find((s) => s.id === priorStudyId);
      if (priorStudy) {
        const priorVolId = Object.keys(priorStudy.volumes || {})[0];
        if (priorVolId && priorStudy.volumes?.[priorVolId]) {
          priorFiles = priorStudy.volumes[priorVolId].files || [];
        } else if (priorStudy.series?.[0]?.images?.length) {
          priorFiles = priorStudy.series[0].images
            .map((img) => img.absPath)
            .filter((p): p is string => Boolean(p) && fs.existsSync(p));
        }
      }
    }

    // Generate unique Job ID
    const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();

    const jobRecord = {
      jobId,
      studyId,
      seriesId: targetSeries?.id || "",
      pipeline,
      status: "queued",
      progress: 0,
      stage: "queued_for_processing",
      cacheKey: `${studyId}:${pipeline}`,
      createdAt: now,
      updatedAt: now,
    };

    const jobsDir = getJobsDir();
    fs.writeFileSync(path.join(jobsDir, `${jobId}.json`), JSON.stringify(jobRecord, null, 2));

    // Spawn detached Python AI worker process
    const pythonExe = getPythonExecutable();
    const args = [
      "-m",
      "services.ai_worker.worker",
      "--pipeline",
      pipeline,
      "--study",
      studyId,
      "--series",
      targetSeries?.id || "",
      "--modality",
      study.modality,
      "--job-id",
      jobId,
    ];

    if (inputFiles.length > 20) {
      const inputFilesListPath = path.join(jobsDir, `${jobId}_input_files.json`);
      fs.writeFileSync(inputFilesListPath, JSON.stringify(inputFiles));
      args.push("--files-file", inputFilesListPath);
    } else if (inputFiles.length > 0) {
      args.push("--files", ...inputFiles);
    }

    if (priorStudyId && priorFiles.length > 20) {
      const priorFilesListPath = path.join(jobsDir, `${jobId}_prior_files.json`);
      fs.writeFileSync(priorFilesListPath, JSON.stringify(priorFiles));
      args.push("--prior-study", priorStudyId);
      args.push("--prior-files-file", priorFilesListPath);
    } else if (priorStudyId && priorFiles.length > 0) {
      args.push("--prior-study", priorStudyId);
      args.push("--prior-files", ...priorFiles);
    }

    if (findings && Array.isArray(findings)) {
      const findingsPath = path.join(jobsDir, `${jobId}_findings.json`);
      fs.writeFileSync(findingsPath, JSON.stringify(findings));
      args.push("--findings-json", findingsPath);
    }

    const workerProcess = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
      detached: true,
      stdio: "ignore",
    });

    workerProcess.unref();

    return NextResponse.json({
      success: true,
      jobId,
      studyId,
      pipeline,
      status: "queued",
      stage: "worker_process_spawned",
    });
  } catch (error) {
    console.error("Job Creation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate AI job" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const studyId = searchParams.get("studyId");

    const jobsDir = getJobsDir();
    const files = fs.readdirSync(jobsDir).filter((f) => f.endsWith(".json"));

    const jobs = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(jobsDir, f), "utf-8"));
        if (!studyId || data.studyId === studyId) {
          jobs.push(data);
        }
      } catch (err) {}
    }

    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json({ jobs: [] });
  }
}
