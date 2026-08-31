"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks";

const PALETTE = ["#3B82F6", "#22D3EE", "#22C55E", "#F59E0B", "#EF4444", "#94A3B8"];

export function DonutChart({ data, size = 140 }: { data: { label: string; value: number }[]; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;
  const reduced = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(reduced);

  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(t);
  }, []);

  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} className="-rotate-90 shrink-0">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth={14} fill="none" />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * circumference;
          const currentOffset = offset;
          const el = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={14}
              fill="none"
              strokeDasharray={drawn ? `${dash} ${circumference - dash}` : `0 ${circumference}`}
              strokeDashoffset={-currentOffset}
              strokeLinecap="butt"
              style={{ transition: `stroke-dasharray 750ms cubic-bezier(0.16,1,0.3,1) ${i * 90}ms` }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-[11.5px]">
            <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-ink-secondary">{d.label}</span>
            <span className="ml-auto font-mono text-ink-primary">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
