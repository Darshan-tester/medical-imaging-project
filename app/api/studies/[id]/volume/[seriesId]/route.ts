import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { getDataRoot, getZipExtractCacheDir } from "@/lib/dataset/config";
import { assertWithinRoot } from "@/lib/dataset/fs-utils";
import { serveMirroredVolume } from "@/lib/dataset/mirror";

export const dynamic = "force-dynamic";

/**
 * Serves one reconstructed series as a raw 8-bit scalar volume for the 3-D view.
 *
 * The body is `dims[0] * dims[1] * dims[2]` bytes, x-fastest, with no header —
 * the shape and the real voxel size travel in `X-Volume-*` headers so the client
 * can build a 3-D texture without parsing anything. Nothing here reveals a file
 * path: the response is pixels and numbers only.
 *
 * Only series that were indexed as a reconstructed stack have a volume. A
 * single-instance X-ray or a NIfTI series returns 404, which is the honest answer
 * — there is no CT stack to render.
 *
 * On Workers the export is served from R2, because `exportDicomVolume` reads the
 * whole stack (558 instances into a 146 MB buffer for CT-C48B2F) and that fits
 * neither the 128 MB isolate ceiling nor any sane R2 request budget.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; seriesId: string }> }) {
  const { id, seriesId } = await params;

  const mirrored = await serveMirroredVolume(id, seriesId, req);
  if (mirrored) return mirrored;

  const manifest = readManifest();
  const study = manifest?.studies.find((s) => s.id === id);
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

  const series = study.series.find((s) => s.id === seriesId);
  if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

  // Optional query param for edge resolution (e.g. ?edge=256)
  const urlObj = new URL(req.url);
  const edgeParam = Number(urlObj.searchParams.get("edge"));
  const maxEdge = Number.isFinite(edgeParam) && edgeParam >= 32 && edgeParam <= 256 ? edgeParam : 256;

  try {
    const { exportDicomVolume, exportNiftiVolume } = await import("@/lib/dataset/image-render");

    // 1. Reconstructed DICOM volume (e.g. CT)
    if (series.volumeId && study.volumes?.[series.volumeId]) {
      const volume = study.volumes[series.volumeId];
      for (const file of volume.files) assertWithinAllowedRoots(file);

      const exported = exportDicomVolume(volume, maxEdge);
      if (!exported) {
        return NextResponse.json(
          { error: "This series could not be reconstructed into a volume" },
          { status: 422 }
        );
      }

      return new NextResponse(new Uint8Array(exported.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(exported.bytes.byteLength),
          "X-Volume-Dims": exported.dims.join(","),
          "X-Volume-Spacing": exported.spacingMm.map((v) => v.toFixed(4)).join(","),
          "X-Volume-Window": `${Math.round(exported.windowLo)},${Math.round(exported.windowHi)}`,
          "X-Volume-Modality": study.modality,
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          ETag: `W/"${manifest?.generatedAt ?? "0"}-${series.volumeId}-3d-${maxEdge}"`,
        },
      });
    }

    // 2. NIfTI volume (e.g. MRI or PET)
    const niftiPath = series.frames?.kind === "nifti"
      ? series.frames.absPath
      : series.images?.find((img) => img.kind === "nifti")?.absPath;

    if (niftiPath) {
      assertWithinAllowedRoots(niftiPath);
      const exported = exportNiftiVolume(niftiPath, maxEdge);
      if (!exported) {
        return NextResponse.json(
          { error: "Unable to parse NIfTI volume for 3D rendering" },
          { status: 422 }
        );
      }

      return new NextResponse(new Uint8Array(exported.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(exported.bytes.byteLength),
          "X-Volume-Dims": exported.dims.join(","),
          "X-Volume-Spacing": exported.spacingMm.map((v) => v.toFixed(4)).join(","),
          "X-Volume-Window": `${Math.round(exported.windowLo)},${Math.round(exported.windowHi)}`,
          "X-Volume-Modality": study.modality,
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          ETag: `W/"${manifest?.generatedAt ?? "0"}-${series.id}-nii-3d-${maxEdge}"`,
        },
      });
    }

    return NextResponse.json(
      { error: "This series does not have a volumetric stack available for 3D rendering" },
      { status: 404 }
    );
  } catch (err) {
    return NextResponse.json({ error: `Unable to build a 3D volume for this series: ${(err as Error).message}` }, { status: 422 });
  }
}


function assertWithinAllowedRoots(absPath: string) {
  try {
    assertWithinRoot(getDataRoot(), absPath);
    return;
  } catch (dataRootErr) {
    try {
      assertWithinRoot(getZipExtractCacheDir(), absPath);
      return;
    } catch {
      throw dataRootErr;
    }
  }
}
