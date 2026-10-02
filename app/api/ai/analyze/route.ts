import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { toAppStudy } from "@/lib/dataset/to-app-study";
import { orchestrateStudyAgents } from "@/lib/agents/orchestrator";
import { Study } from "@/lib/types";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { studyId, customFindings } = body;

    if (!studyId) {
      return NextResponse.json({ error: "Missing studyId parameter" }, { status: 400 });
    }

    const manifest = readManifest();
    const ds = manifest?.studies.find((s) => s.id === studyId);

    if (!ds) {
      return NextResponse.json({ error: "Study not found in active manifest" }, { status: 404 });
    }

    const appStudy: Study = toAppStudy(ds);

    // If study is Chest X-Ray and real file exists on D:\ScanLab_Datasets, run neural inference
    const isChestXray = appStudy.modality === "X-Ray";
    let neuralResult = null;

    if (isChestXray && ds.series[0]?.images[0]?.absPath) {
      const imgPath = ds.series[0].images[0].absPath;
      if (fs.existsSync(imgPath)) {
        try {
          const pythonPath = `C:\\Users\\QUIKCARE COMPUTERS\\AppData\\Local\\Programs\\Python\\Python310\\python.exe`;
          const scriptPath = path.join(process.cwd(), "scripts", "ai", "model_inference.py");

          const { stdout } = await execFileAsync(pythonPath, [scriptPath, imgPath], {
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
            timeout: 30000,
          });

          neuralResult = JSON.parse(stdout);
        } catch (inferErr) {
          console.warn("Neural inference execution note:", inferErr);
        }
      }
    }

    // Orchestrate multi-agent system
    const agenticState = orchestrateStudyAgents(appStudy);

    // If neural inference succeeded, merge detected pathologies and report
    if (neuralResult && neuralResult.findings && neuralResult.findings.length > 0) {
      agenticState.imagingAnalysis.findings = neuralResult.findings;
      if (neuralResult.report) {
        agenticState.reportDraft.draftSections.findings = neuralResult.report.findings;
        agenticState.reportDraft.draftSections.impression = neuralResult.report.impression;
      }
    }

    return NextResponse.json({
      success: true,
      studyId,
      agenticState,
      neuralModelUsed: neuralResult ? neuralResult.model : "Meridian Multimodal Clinical Agent Suite",
    });
  } catch (error) {
    console.error("AI Analysis Route Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal AI analysis failure" },
      { status: 500 }
    );
  }
}
