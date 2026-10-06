import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { isValidIdentifier, isPathInside } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ studyId: string; meshName: string }> }
) {
  const { studyId, meshName } = await params;

  if (!studyId || !meshName) {
    return NextResponse.json({ error: "Missing studyId or meshName" }, { status: 400 });
  }

  if (!isValidIdentifier(studyId) || !isValidIdentifier(meshName)) {
    return NextResponse.json({ error: "Invalid studyId or meshName parameter" }, { status: 400 });
  }

  const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
  const meshesDir = path.join(derivedDir, "meshes");
  let meshPath = path.join(meshesDir, meshName);

  if (!fs.existsSync(/*turbopackIgnore: true*/ meshPath)) {
    const stem = meshName.replace(/\.(glb|vtp|vtk)$/i, "");
    const candidates = [
      path.join(derivedDir, "heart", meshName),
      path.join(derivedDir, "heart", "mesh.glb"),
      path.join(derivedDir, "lungs", meshName),
      path.join(derivedDir, "lungs", "mesh.glb"),
      path.join(derivedDir, "brain", "meshes", meshName),
      path.join(derivedDir, "motion4d", "frames", meshName),
      path.join(derivedDir, "motion4d", meshName),
      path.join(derivedDir, stem, "mesh.glb"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ c)) {
        meshPath = c;
        break;
      }
    }
  }

  if (!isPathInside(meshPath, derivedDir) || !fs.existsSync(/*turbopackIgnore: true*/ meshPath)) {
    return NextResponse.json({ error: "Mesh file not found" }, { status: 404 });
  }

  const stat = fs.statSync(/*turbopackIgnore: true*/ meshPath);
  const fileBuffer = fs.readFileSync(/*turbopackIgnore: true*/ meshPath);

  const contentType = meshName.endsWith(".glb")
    ? "model/gltf-binary"
    : "application/octet-stream";

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      ETag: `"${studyId}-${meshName}-${stat.mtimeMs}"`,
    },
  });
}
