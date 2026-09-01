import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { exportDicomVolume } from "@/lib/dataset/image-render";
import { getDataRoot, getZipExtractCacheDir } from "@/lib/dataset/config";
import { assertWithinRoot } from "@/lib/dataset/fs-utils";

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
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; seriesId: string }> }) {
  const { id, seriesId } = await params;
  const manifest = readManifest();
  const study = manifest?.studies.find((s) => s.id === id);
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

  const series = study.series.find((s) => s.id === seriesId);
  if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

  if (!series.volumeId) {
    return NextResponse.json({ error: "This series is not a reconstructed volume, so it has no 3D form" }, { status: 404 });
  }

  const volume = study.volumes?.[series.volumeId];
  if (!volume) {
    return NextResponse.json(
      { error: "This reconstructed series has no volume in the index — re-run `npm run dataset:index`" },
      { status: 422 }
    );
  }

  try {
    // Same defense in depth as the image route: these paths come from our own
    // manifest, and they are re-checked against the only two roots a real file
    // may live under before anything is read.
    for (const file of volume.files) assertWithinAllowedRoots(file);

    const exported = exportDicomVolume(volume);
    if (!exported) {
      return NextResponse.json(
        { error: "This series could not be reconstructed into a volume — its instances are inconsistent or compressed" },
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
        // Same reasoning as the image route: the URL is stable across a re-index
        // but the bytes are not, so revalidate rather than cache immutably.
        "Cache-Control": "public, max-age=60, must-revalidate",
        ETag: `W/"${manifest?.generatedAt ?? "0"}-${series.volumeId}-3d"`,
      },
    });
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
