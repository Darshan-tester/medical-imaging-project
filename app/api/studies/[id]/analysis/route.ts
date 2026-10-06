import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { isValidIdentifier } from "@/lib/ai-security";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function getPythonExecutable(): string {
  const venvPython = path.join(process.cwd(), "services", "ai_worker", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(/*turbopackIgnore: true*/ venvPython)) return venvPython;
  const sysPython = "C:\\Program Files\\Python313\\python.exe";
  if (fs.existsSync(/*turbopackIgnore: true*/ sysPython)) return sysPython;
  return "python";
}

function getJobsDir(): string {
  const jobsDir = path.join(process.cwd(), ".scanlab", "derived", ".jobs");
  if (!fs.existsSync(/*turbopackIgnore: true*/ jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  return jobsDir;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid or missing studyId parameter" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { seriesId, pipeline = "segmentation", priorStudyId, options = {} } = body;

    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found in active manifest" }, { status: 404 });
    }

    // Check Cache (Section 23)
    const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
    const metadataPath = path.join(derivedDir, "metadata.json");
    const manifestPath = path.join(derivedDir, "manifest.json");

    for (const targetPath of [metadataPath, manifestPath]) {
      if (fs.existsSync(/*turbopackIgnore: true*/ targetPath)) {
        try {
          const cachedData = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ targetPath, "utf-8"));
          if (cachedData.status === "completed" && (cachedData.pipeline === pipeline || pipeline === "all")) {
            return NextResponse.json({
              jobId: `cached-${studyId}`,
              studyId,
              status: "completed",
              progress: 100,
              stage: "cached_output_ready",
              cached: true,
              result: cachedData,
            });
          }
        } catch (e) {}
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
        .filter((p): p is string => Boolean(p) && fs.existsSync(/*turbopackIgnore: true*/ p));
    }

    let priorFiles: string[] = [];
    if (priorStudyId && isValidIdentifier(priorStudyId)) {
      const priorStudy = manifest?.studies.find((s) => s.id === priorStudyId);
      if (priorStudy) {
        const priorVolId = Object.keys(priorStudy.volumes || {})[0];
        if (priorVolId && priorStudy.volumes?.[priorVolId]) {
          priorFiles = priorStudy.volumes[priorVolId].files || [];
        } else if (priorStudy.series?.[0]?.images?.length) {
          priorFiles = priorStudy.series[0].images
            .map((img) => img.absPath)
            .filter((p): p is string => Boolean(p) && fs.existsSync(/*turbopackIgnore: true*/ p));
        }
      }
    }

    const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();

    const jobRecord = {
      jobId,
      studyId,
      seriesId: targetSeries?.id || "",
      pipeline,
      status: "queued",
      progress: 0,
      stage: "queued_in_worker",
      cacheKey: `${studyId}:${pipeline}`,
      createdAt: now,
      updatedAt: now,
      options,
    };

    const jobsDir = getJobsDir();
    fs.writeFileSync(path.join(jobsDir, `${jobId}.json`), JSON.stringify(jobRecord, null, 2));

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

    const workerProcess = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
      detached: true,
      stdio: "ignore",
    });
    workerProcess.unref();

    return NextResponse.json({
      jobId,
      studyId,
      status: "queued",
      progress: 0,
      pipeline,
    });
  } catch (error) {
    console.error("Analysis initiation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to trigger analysis" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
    const metadataPath = path.join(derivedDir, "metadata.json");
    const manifestPath = path.join(derivedDir, "manifest.json");

    let metadata = null;
    for (const p of [metadataPath, manifestPath]) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        try {
          metadata = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ p, "utf-8"));
          break;
        } catch (e) {}
      }
    }

    if (!metadata) {
      return NextResponse.json({
        studyId,
        status: "not_started",
        derivedAvailable: false,
      });
    }

    return NextResponse.json({
      studyId,
      status: metadata.status || "completed",
      pipeline: metadata.pipeline,
      model: metadata.model,
      modelVersion: metadata.modelVersion,
      processingTimeMs: metadata.processingTimeMs,
      derivedAvailable: true,
      segments: metadata.segments || [],
      meshes: metadata.meshes || [],
      metrics: metadata.metrics || {},
      derivedAssets: {
        heart: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "heart", "mesh.glb")) || fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "meshes", "heart.glb")),
        lungs: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "lungs", "mesh.glb")) || fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "meshes", "lung_right.glb")),
        brain: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "brain", "parcellation.nii.gz")),
        registration: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "registration", "registered_prior.nii.gz")),
        motion4d: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "motion4d", "animation.glb")),
        findings: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "findings", "findings.json")),
        report: fs.existsSync(/*turbopackIgnore: true*/ path.join(derivedDir, "report", "draft.json")),
      },
      metadata,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to query analysis status" }, { status: 500 });
  }
}
