import { NextResponse } from "next/server";
import { isValidIdentifier, isPathInside } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".vtp": "application/octet-stream",
  ".vtk": "text/plain",
  ".gz": "application/gzip",
  ".nii": "application/octet-stream",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  try {
    const { id: studyId, path: subPathSegments } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const subPath = subPathSegments.join("/");
    // Basic sanitization
    if (subPath.includes("..")) {
      return NextResponse.json({ error: "Invalid path navigation" }, { status: 400 });
    }

    const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
    let targetFile = path.join(derivedDir, ...subPathSegments);

    // Backward compatibility fallback for legacy mesh paths
    if (!fs.existsSync(targetFile)) {
      if (subPathSegments.length === 1 && subPathSegments[0].endsWith(".glb")) {
        // e.g. /api/studies/{studyId}/derived/heart.glb -> check meshes/heart.glb or heart/mesh.glb
        const stem = subPathSegments[0].replace(".glb", "");
        const alt1 = path.join(derivedDir, "meshes", subPathSegments[0]);
        const alt2 = path.join(derivedDir, stem, "mesh.glb");
        if (fs.existsSync(alt1)) targetFile = alt1;
        else if (fs.existsSync(alt2)) targetFile = alt2;
      }
    }

    if (!isPathInside(targetFile, derivedDir) || !fs.existsSync(targetFile)) {
      return NextResponse.json({ error: "Derived asset not found" }, { status: 404 });
    }

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const fileBuffer = fs.readFileSync(targetFile);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to read derived asset" }, { status: 500 });
  }
}
