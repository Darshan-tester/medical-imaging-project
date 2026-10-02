import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { isValidIdentifier, isPathInside } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studyId: string; meshName: string }> }
) {
  const { studyId, meshName } = await params;

  if (!studyId || !meshName) {
    return NextResponse.json({ error: "Missing studyId or meshName" }, { status: 400 });
  }

  if (!isValidIdentifier(studyId) || !isValidIdentifier(meshName)) {
    return NextResponse.json({ error: "Invalid studyId or meshName parameter" }, { status: 400 });
  }

  const meshesDir = path.join(process.cwd(), ".scanlab", "derived", studyId, "meshes");
  const meshPath = path.join(meshesDir, meshName);

  if (!isPathInside(meshPath, meshesDir) || !fs.existsSync(meshPath)) {
    return NextResponse.json({ error: "Mesh file not found" }, { status: 404 });
  }

  const stat = fs.statSync(meshPath);
  const fileBuffer = fs.readFileSync(meshPath);

  const contentType = meshName.endsWith(".glb")
    ? "model/gltf-binary"
    : meshName.endsWith(".vtp") || meshName.endsWith(".vtk")
    ? "application/octet-stream"
    : "application/octet-stream";

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      ETag: `"${studyId}-${meshName}-${stat.mtimeMs}"`,
    },
  });
}
