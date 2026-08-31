import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { renderImageCached } from "@/lib/dataset/image-render";
import { getDataRoot, getZipExtractCacheDir } from "@/lib/dataset/config";
import { assertWithinRoot } from "@/lib/dataset/fs-utils";
import { seriesImageAt } from "@/lib/dataset/series-frames";
import { DicomVolumeRef } from "@/lib/dataset/types";

export const dynamic = "force-dynamic";

/**
 * Serves the pixels for one indexed image.
 *
 * `?w=<int>` returns the same image downscaled so its longest edge is `<int>`
 * pixels (16-1024, anything else is ignored). Thumbnails and study cards use it
 * so a 44 px box stops downloading a full-resolution reslice. A source JPEG is
 * always returned at full size — see `RenderOptions.maxEdge`.
 */
export async function GET(req: Request, { params }: { params: { id: string; path: string[] } }) {
  const [seriesId, indexStr] = params.path;
  const index = Number(indexStr);

  const manifest = readManifest();
  const study = manifest?.studies.find((s) => s.id === params.id);
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

  const series = study.series.find((s) => s.id === seriesId);
  if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

  // Resolved through the accessor because a reconstructed plane stores its
  // slices as one compact run, not as an array to search.
  const image = seriesImageAt(series, index);
  if (!image) return NextResponse.json({ error: "Image index not found" }, { status: 404 });

  const width = parseWidth(req.url);

  // Reconstructed series reslice a stack that is stored once on the study.
  const volume = series.volumeId ? study.volumes?.[series.volumeId] : undefined;
  if (series.volumeId && !volume) {
    return NextResponse.json(
      { error: "This reconstructed series has no volume in the index — re-run `npm run dataset:index`" },
      { status: 422 }
    );
  }

  /*
   * The URL of a given slice is stable across re-indexing, but its *content*
   * is not — an adapter fix changes the pixels behind the same path. The old
   * `immutable` header meant a browser that had loaded the viewer once would
   * keep showing pre-fix renders forever, which is indistinguishable from the
   * fix not working. Revalidating against the manifest's own timestamp keeps
   * scrolling fast while making a re-index take effect on reload.
   */
  const etag = `W/"${manifest?.generatedAt ?? "0"}-${image.id}-${width ?? 0}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE_CONTROL } });
  }

  try {
    // Defense in depth: even though these paths come from our own trusted
    // manifest (never from this request), re-verify they still sit inside
    // either SCANLAB_DATA_ROOT (most files) or the managed ZIP-extraction cache
    // (files pulled out of a per-study ZIP, e.g. MRI) — the only two places a
    // real image file is ever allowed to come from.
    assertWithinAllowedRoots(image.absPath);
    if (volume) assertVolumeWithinAllowedRoots(`${manifest?.generatedAt ?? "0"}::${series.volumeId}`, volume);

    const rendered = renderImageCached(etag, image, { volume, maxEdge: width });
    return new NextResponse(rendered.bytes, {
      status: 200,
      headers: {
        "Content-Type": rendered.contentType,
        "Cache-Control": CACHE_CONTROL,
        ETag: etag,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Unable to render this study image: ${(err as Error).message}` }, { status: 422 });
  }
}

/** Short enough that a re-index is picked up on the next reload, long enough that cine scrubbing isn't a conditional request per frame. */
const CACHE_CONTROL = "public, max-age=60, must-revalidate";

function parseWidth(url: string): number | undefined {
  const raw = new URL(url).searchParams.get("w");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
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

/**
 * A volume is a few hundred paths and every one of them gets read, so all of
 * them are checked — but only once per volume per process, keyed by the
 * manifest timestamp so a re-index re-checks. Re-walking the list on every
 * slice request would be pure overhead during cine playback.
 */
const verifiedVolumes = new Set<string>();

function assertVolumeWithinAllowedRoots(key: string, volume: DicomVolumeRef) {
  if (verifiedVolumes.has(key)) return;
  for (const file of volume.files) assertWithinAllowedRoots(file);
  verifiedVolumes.add(key);
}
