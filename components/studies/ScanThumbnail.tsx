"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modality } from "@/lib/types";
import { ctPerfRendered } from "@/lib/viewer/perf";
import { PRIORITY } from "@/lib/viewer/request-queue";
import { peekSlice } from "@/lib/viewer/slice-cache";
import { isDecodableUrl, loadSlice, releaseSlice } from "@/lib/viewer/slice-source";
import { cn } from "@/lib/utils";

const MODALITY_TINT: Record<Modality, string> = {
  CT: "#3B82F6",
  MRI: "#22D3EE",
  "X-Ray": "#94A3B8",
  Ultrasound: "#22C55E",
  PET: "#F59E0B",
  Mammography: "#EF4444",
};

/**
 * Procedurally generated grayscale-noise placeholder standing in for a scan
 * preview. No real or copyrighted medical imagery is used anywhere in this
 * project — this is a synthetic texture seeded per study for visual variety.
 * Only ever shown when there is no real uploaded image to display.
 */
function PlaceholderTexture({ seed, modality, className }: { seed: number; modality: Modality; className?: string }) {
  const id = `noise-${seed}`;
  const tint = MODALITY_TINT[modality];
  const freq = 0.012 + (seed % 7) * 0.004;

  return (
    <svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={3} seed={seed % 100} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.7  0 0 0 0 0.76  0 0 0 0 0.82  0 0 0 0.5 0" />
        </filter>
        <radialGradient id={`vign-${seed}`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor={tint} stopOpacity="0.22" />
          <stop offset="60%" stopColor="#0F172A" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0A0F1C" stopOpacity="0.95" />
        </radialGradient>
      </defs>
      <rect width="300" height="300" fill="#0F172A" />
      <rect width="300" height="300" filter={`url(#${id})`} />
      <rect width="300" height="300" fill={`url(#vign-${seed})`} />
    </svg>
  );
}

/**
 * Renders the actual scan. If `imageUrl` is set (a real file the person
 * uploaded), that image is shown at full sharpness — no blur, no filters
 * beyond what the viewer's own brightness/contrast tools apply. If it's
 * missing or fails to load, this falls back to the synthetic placeholder
 * texture so seeded demo studies still render something reasonable.
 *
 * Two kinds of URL arrive here. Most are something an `<img>` can load directly:
 * a raster file, or an `/api/studies/.../images/...` route that returns a PNG the
 * server rendered. The rest have to be decoded in the browser, and this component
 * is where that happens because it is the one place both the study cards and the
 * diagnostic viewer go through:
 *
 * - the committed `public/demo-data` studies, whose pixels are a DICOM instance
 *   or a slice of a gzipped NIfTI volume marked by the query parameters in
 *   `lib/demo/types.ts`, because the deployed Worker has no filesystem to render
 *   them from;
 * - an uploaded study, whose pixels are bytes in IndexedDB marked by the
 *   `/_uploaded/…?up=1` form in `lib/uploads/types.ts`, and which were never on a
 *   server at all.
 *
 * The two decoders are separate modules over the same shared DICOM path, and
 * which one runs is decided by the marker alone. A demo URL can never resolve
 * from the upload store, and an upload URL can never resolve from the demo index.
 * Both are reached through `lib/viewer/slice-source.ts`, which owns the on-demand
 * import — a static one would put `dicom-parser` and `nifti-reader-js` in the
 * bundle of every page that renders a thumbnail.
 */
export function ScanThumbnail({
  seed,
  modality,
  className,
  imageUrl,
  animated = false,
  fit = "cover",
  loading,
  priority = PRIORITY.current,
  loadingLabel,
  onFailure,
  onReady,
  onNaturalSize,
}: {
  seed: number;
  modality: Modality;
  className?: string;
  imageUrl?: string;
  /** Subtle slow Ken-Burns drift — only used on static preview cards, never in the diagnostic viewer. */
  animated?: boolean;
  /**
   * `cover` crops to fill — right for square cards. `contain` letterboxes so
   * the whole image is visible, which is the only correct choice in the
   * diagnostic viewer: a cropped reslice silently hides anatomy at the edges,
   * and a sagittal CT reslice is nowhere near square.
   */
  fit?: "cover" | "contain";
  /** Pass "lazy" for off-screen grids/strips so a 41-thumbnail row doesn't issue 41 immediate requests. */
  loading?: "eager" | "lazy";
  /**
   * Scheduling band for a decoded slice, from `PRIORITY`.
   *
   * `loading="lazy"` does nothing for a decode-marked URL — the fetch happens in
   * the decode step, not in the `<img>` — so this is what keeps a filmstrip of
   * tiles from competing with the slice the reader is waiting for. Defaults to
   * `current`, i.e. the standing every request had when there was no scheduler.
   */
  priority?: number;
  /** Shown while a slice is decoding, e.g. "Slice 17 / 443". A spinner alone if omitted. */
  loadingLabel?: string;
  /** Lets the parent surface a real error state instead of a placeholder that looks like data. */
  onFailure?: () => void;
  /** Fired when these exact pixels are on screen — used to gate cine playback on decode. */
  onReady?: () => void;
  /**
   * The image's own pixel dimensions, once known.
   *
   * `object-contain` letterboxes anything that is not square, so the frame and
   * the visible image are different rectangles. Anything drawn in image
   * coordinates — the AI finding boxes — has to be placed against the second
   * one, and this is the only place that knows how big it is.
   */
  onNaturalSize?: (size: { width: number; height: number }) => void;
}) {
  /**
   * The decoded slice, tagged with the URL it belongs to.
   *
   * Tagged rather than reset by an effect, because an effect runs after the
   * browser has painted: on the frame after `imageUrl` changed, a plain
   * `decodedUrl` state still held the *previous* slice's pixels, so stepping
   * through a series painted one frame of the slice you just left. Comparing the
   * tag during render means that frame cannot happen.
   *
   * The object URL is never revoked here: it is owned by the LRU in
   * `lib/viewer/slice-cache.ts`, which revokes on eviction. Revoking on unmount
   * would leave that cache handing out a dead blob to the next component that
   * asks for the same slice.
   */
  const [decoded, setDecoded] = useState<{ url: string; objectUrl: string }>();
  const [failedUrl, setFailedUrl] = useState<string>();

  const needsDecode = isDecodableUrl(imageUrl);
  const failed = failedUrl !== undefined && failedUrl === imageUrl;

  /*
   * Synchronous cache read, during render. A slice that is already decoded — the
   * one you just stepped away from, or a neighbour the preloader warmed — is on
   * screen on this frame, with no spinner in between. Going through the decode
   * module for the same answer would cost a dynamic import and a microtask, which
   * is a frame of spinner: the difference between "instant" and "nearly instant".
   */
  const ready = !needsDecode
    ? undefined
    : decoded?.url === imageUrl
      ? decoded.objectUrl
      : peekSlice(imageUrl)?.objectUrl;

  /*
   * Held in a ref rather than listed as an effect dependency. The viewer passes
   * fresh closures on every render, so depending on them would restart the
   * decode continuously — on a scroll through a 443-slice CT series that is the
   * difference between one fetch per slice and an unbounded number.
   */
  const onFailureRef = useRef(onFailure);
  const onFailureCurrent = onFailure;
  useEffect(() => {
    onFailureRef.current = onFailureCurrent;
  }, [onFailureCurrent]);

  /*
   * Same reasoning for priority: a filmstrip tile's band changes as the window
   * slides past it, and restarting a decode because a tile moved one place closer
   * would undo the scheduling this is for. The band that counts is the one at the
   * moment the request is made.
   */
  const priorityRef = useRef(priority);
  priorityRef.current = priority;

  useEffect(() => {
    if (imageUrl === undefined || !isDecodableUrl(imageUrl)) return;

    // Already decoded — the render above is showing it. No claim, so no release.
    if (peekSlice(imageUrl)) return;

    let cancelled = false;

    void loadSlice(imageUrl, priorityRef.current)
      .then((image) => {
        if (!cancelled) setDecoded({ url: imageUrl, objectUrl: image.objectUrl });
      })
      .catch(() => {
        // Same contract as a failed <img>: surface it, never substitute pixels.
        // A dropped request rejects too, and the URL it was for is no longer the
        // one being shown, so `cancelled` covers that case as well.
        if (cancelled) return;
        setFailedUrl(imageUrl);
        onFailureRef.current?.();
      });

    return () => {
      cancelled = true;
      // Lets the scheduler drop work nobody is waiting for any more. A slice that
      // has already started keeps going — its bytes are still worth caching.
      releaseSlice(imageUrl);
    };
  }, [imageUrl]);

  /*
   * Decoding a slice takes a fetch plus a canvas pass, and the placeholder
   * texture is not an honest thing to show in the meantime: it is synthetic
   * noise, and on a real study it would read as data. An empty viewer-coloured
   * frame is what is actually true — the pixels are on their way.
   */
  if (needsDecode && !ready && !failed) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center gap-2 overflow-hidden bg-viewer",
          className
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin text-ink-muted/60" aria-hidden />
        {loadingLabel ? (
          <span className="text-xs tabular-nums text-ink-muted/70">{loadingLabel}</span>
        ) : null}
        <span className="sr-only">Decoding {modality} image</span>
      </div>
    );
  }

  const src = needsDecode ? ready : imageUrl;

  if (src && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-viewer", className)}>
        {/* Real uploaded scan — a plain <img> is intentional: next/image can't
            optimize local blob: object URLs, and doing so would add latency
            for zero benefit on an in-memory demo file. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${modality} scan`}
          draggable={false}
          loading={loading}
          decoding="async"
          onError={() => {
            setFailedUrl(imageUrl);
            onFailure?.();
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onNaturalSize?.({ width: img.naturalWidth, height: img.naturalHeight });
            }
            // The only timing that matches what the person in front of the screen
            // saw. Development-only inside; a no-op in production.
            if (imageUrl !== undefined) ctPerfRendered(imageUrl);
            onReady?.();
          }}
          className={cn(
            "h-full w-full select-none",
            fit === "contain" ? "object-contain" : "object-cover",
            animated && "animate-[kenburns_18s_ease-in-out_infinite]"
          )}
          style={{ imageRendering: "auto" }}
        />
      </div>
    );
  }

  return <PlaceholderTexture seed={seed} modality={modality} className={className} />;
}
