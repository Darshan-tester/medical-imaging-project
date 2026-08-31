"use client";

import { useEffect, useState } from "react";
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
}) {
  const [failed, setFailed] = useState(false);

  /*
   * Reset on URL change. Without this, one failed slice latched `failed` for
   * the lifetime of the component, and because the viewer reuses a single
   * <ScanThumbnail> across every slice, a single transient 422 turned the rest
   * of the series into synthetic noise that looks like a real (if ugly) scan.
   */
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (imageUrl && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-viewer", className)}>
        {/* Real uploaded scan — a plain <img> is intentional: next/image can't
            optimize local blob: object URLs, and doing so would add latency
            for zero benefit on an in-memory demo file. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`${modality} scan`}
          draggable={false}
          loading={loading}
          decoding="async"
          onError={() => {
            setFailed(true);
            onFailure?.();
          }}
          onLoad={() => onReady?.()}
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
