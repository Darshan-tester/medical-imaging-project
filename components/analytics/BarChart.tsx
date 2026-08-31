"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks";

export function BarChart({
  data,
  height = 160,
  color = "#3B82F6",
  colors,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  /** Optional per-bar override colors (e.g. distinct semantic states). Falls back to `color` when absent. */
  colors?: string[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / data.length;
  const reduced = usePrefersReducedMotion();
  const [grown, setGrown] = useState(reduced);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const t = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = grown ? (d.value / max) * (height - 24) : 0;
          const barColor = colors?.[i] ?? color;
          return (
            <g key={d.label} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <rect x={i * barWidth + barWidth * 0.22} y={0} width={barWidth * 0.56} height={height - 24} rx={1.5} fill="transparent" />
              <rect
                x={i * barWidth + barWidth * 0.22}
                y={height - 24 - h}
                width={barWidth * 0.56}
                height={h}
                rx={1.5}
                fill={barColor}
                fillOpacity={hovered === i ? 1 : 0.85}
                style={{ transition: `height 650ms cubic-bezier(0.16,1,0.3,1) ${i * 60}ms, y 650ms cubic-bezier(0.16,1,0.3,1) ${i * 60}ms, fill-opacity 150ms ease-out` }}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex text-[9.5px] text-ink-muted">
        {data.map((d, i) => (
          <div key={d.label} style={{ width: `${barWidth}%` }} className={`truncate text-center transition-colors ${hovered === i ? "font-medium text-ink-primary" : ""}`}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
