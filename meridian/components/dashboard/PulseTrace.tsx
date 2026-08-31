"use client";

import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/lib/hooks";

// One repeatable QRS-complex-shaped segment. Several copies are laid side by
// side and scrolled leftward continuously, so the trace never resets or
// "jumps" — same trick a real bedside monitor uses.
const SEGMENT_WIDTH = 160;
const VIEW_HEIGHT = 72;
const VISIBLE_SEGMENTS = 5;
const SEGMENT_PATH =
  "M0 36 H26 L34 36 L40 18 L46 56 L52 26 L58 36 H88 L96 27 L102 36 H124 L130 32 L136 36 H160";

export function PulseTrace({ bpm }: { bpm: number }) {
  const reduced = usePrefersReducedMotion();
  const viewWidth = SEGMENT_WIDTH * VISIBLE_SEGMENTS;
  const secondsPerBeat = 60 / bpm;
  const duration = secondsPerBeat * VISIBLE_SEGMENTS;
  const segments = Array.from({ length: VISIBLE_SEGMENTS * 2 }, (_, i) => i);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-[rgb(var(--overlay-hover)/0.03)]">
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Live electrocardiogram trace at ${bpm} beats per minute`}
      >
        <g className="stroke-[rgb(var(--overlay-hover)/0.07)]" strokeWidth="1">
          {[0, 18, 36, 54, 72].map((y) => (
            <line key={`h-${y}`} x1="0" y1={y} x2={viewWidth} y2={y} />
          ))}
          {Array.from({ length: Math.floor(viewWidth / 40) + 1 }, (_, i) => i * 40).map((x) => (
            <line key={`v-${x}`} x1={x} y1="0" x2={x} y2={VIEW_HEIGHT} />
          ))}
        </g>

        <motion.g
          animate={reduced ? { x: 0 } : { x: [0, -viewWidth] }}
          transition={{ duration, ease: "linear", repeat: Infinity }}
        >
          {segments.map((index) => (
            <path
              key={index}
              d={SEGMENT_PATH}
              transform={`translate(${index * SEGMENT_WIDTH} 0)`}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-critical"
              style={{ filter: "drop-shadow(0 0 5px rgb(var(--color-critical) / 0.7))" }}
            />
          ))}
        </motion.g>
      </svg>
    </div>
  );
}
