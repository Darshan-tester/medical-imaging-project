import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { renderImage } from "@/lib/dataset/image-render";
import { getDataRoot, getZipExtractCacheDir } from "@/lib/dataset/config";
import { assertWithinRoot } from "@/lib/dataset/fs-utils";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string; path: string[] } }) {
  const [seriesId, indexStr] = params.path;
  const index = Number(indexStr);

  const manifest = readManifest();
  const study = manifest?.studies.find((s) => s.id === params.id);
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

  const series = study.series.find((s) => s.id === seriesId);
  if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

  const image = series.images.find((img) => img.index === index);
  if (!image) return NextResponse.json({ error: "Image index not found" }, { status: 404 });

  try {
    // Defense in depth: even though `image.absPath` comes from our own
    // trusted manifest (never from this request), re-verify it still sits
    // inside either SCANLAB_DATA_ROOT (most files) or the managed
    // ZIP-extraction cache (files pulled out of a per-study ZIP, e.g. MRI) —
    // the only two places a real image file is ever allowed to come from.
    assertWithinAllowedRoots(image.absPath);
    const rendered = renderImage(image);
    return new NextResponse(rendered.bytes, {
      status: 200,
      headers: {
        "Content-Type": rendered.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Unable to render this study image: ${(err as Error).message}` }, { status: 422 });
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
