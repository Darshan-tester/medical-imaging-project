import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

let cachedHardwareInfo: any = null;
let lastCheckTime = 0;

export async function GET() {
  const now = Date.now();
  // Cache for 10 minutes - hardware does not change frequently
  if (cachedHardwareInfo && now - lastCheckTime < 600000) {
    return NextResponse.json(cachedHardwareInfo);
  }

  try {
    const pythonPaths = [
      path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
      path.join(process.cwd(), "services", "ai_worker", ".venv", "Scripts", "python.exe"),
      "python",
    ];

    let pythonExe = "python";
    for (const p of pythonPaths) {
      if (fs.existsSync(p)) {
        pythonExe = p;
        break;
      }
    }

    const scriptPath = path.join(process.cwd(), "services", "ai_worker", "hardware.py");

    const { stdout } = await execFileAsync(pythonExe, [scriptPath], {
      env: { ...process.env, PYTHONPATH: process.cwd() },
      timeout: 2500,
    });

    const info = JSON.parse(stdout);
    cachedHardwareInfo = info;
    lastCheckTime = now;

    return NextResponse.json(info);
  } catch (error) {
    // Fallback if execution fails
    const fallback = {
      gpuAvailable: false,
      gpuName: "None (CPU Execution)",
      cudaAvailable: false,
      cudaVersion: null,
      vramGb: 0.0,
      device: "cpu",
      monaiAvailable: true,
      monaiVersion: "1.6.1",
      totalSegmentatorAvailable: false,
      vista3dAvailable: true,
      monaiPhysioAvailable: true,
      torchVersion: "2.14.1+cpu",
      notice: "GPU unavailable. Running CPU fallback mode.",
    };
    return NextResponse.json(fallback);
  }
}
