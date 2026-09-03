"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { isDemoDecodeUrl } from "@/lib/demo/types";
import { isUploadDecodeUrl } from "@/lib/uploads/types";
import { Modality } from "@/lib/types";
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
 */
export function ScanThumbnail({
  seed,
  modality,
  className,
  imageUrl,
  animated = false,
  fit = "cover",
  loading,
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
  const [failed, setFailed] = useState(false);

  /**
   * The object URL for a locally decoded slice, once it exists.
   *
   * Never revoked here: the URL is owned by the LRU cache in the decode module
   * that produced it, which revokes it on eviction. Revoking on unmount would
   * leave that cache handing out a dead blob to the next component that asks for
   * the same slice.
   */
  const [decodedUrl, setDecodedUrl] = useState<string>();

  const needsDecode = imageUrl !== undefined && (isDemoDecodeUrl(imageUrl) || isUploadDecodeUrl(imageUrl));

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
   * Reset on URL change. Without this, one failed slice latched `failed` for
   * the lifetime of the component, and because the viewer reuses a single
   * <ScanThumbnail> across every slice, a single transient 422 turned the rest
   * of the series into synthetic noise that looks like a real (if ugly) scan.
   */
  useEffect(() => {
    setFailed(false);
    setDecodedUrl(undefined);

    if (imageUrl === undefined) return;

    /*
     * Imported on demand, not at module scope. Both decode modules pull in
     * `dicom-parser` and `nifti-reader-js`; a static import would put both in the
     * bundle of every page that renders a thumbnail, including the modes that
     * never produce a decode-marked URL at all.
     *
     * The marker picks the module. Nothing falls back to the other one: a demo
     * slice that fails to decode is not looked for in the upload store, and an
     * uploaded slice that is missing does not go looking for a demo study.
     */
    const decode = isDemoDecodeUrl(imageUrl)
      ? () => import("@/lib/demo/decode").then((mod) => mod.decodeDemoImage(imageUrl))
      : isUploadDecodeUrl(imageUrl)
        ? () => import("@/lib/uploads/decode").then((mod) => mod.decodeUploadImage(imageUrl))
        : undefined;

    if (!decode) return;

    let cancelled = false;

    void decode()
      .then((image) => {
        if (!cancelled) setDecodedUrl(image.objectUrl);
      })
      .catch(() => {
        // Same contract as a failed <img>: surface it, never substitute pixels.
        if (cancelled) return;
        setFailed(true);
        onFailureRef.current?.();
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  /*
   * Decoding a slice takes a fetch plus a canvas pass, and the placeholder
   * texture is not an honest thing to show in the meantime: it is synthetic
   * noise, and on a real study it would read as data. An empty viewer-coloured
   * frame is what is actually true — the pixels are on their way.
   */
  if (needsDecode && !decodedUrl && !failed) {
    return (
      <div className={cn("relative flex items-center justify-center overflow-hidden bg-viewer", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-ink-muted/60" aria-hidden />
        <span className="sr-only">Decoding {modality} image</span>
      </div>
    );
  }

  const src = needsDecode ? decodedUrl : imageUrl;

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
            setFailed(true);
            onFailure?.();
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onNaturalSize?.({ width: img.naturalWidth, height: img.naturalHeight });
            }
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
