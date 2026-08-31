import { cn } from "@/lib/utils";
import { AIConfidenceBand } from "@/lib/types";

function bandColor(band: AIConfidenceBand) {
  if (band === "high") return { bar: "bg-success", text: "text-success", ring: "stroke-success" };
  if (band === "moderate") return { bar: "bg-warning", text: "text-warning", ring: "stroke-warning" };
  return { bar: "bg-critical", text: "text-critical", ring: "stroke-critical" };
}

export function ConfidenceIndicator({
  value,
  band,
  size = "md",
  showLabel = true,
}: {
  value: number;
  band: AIConfidenceBand;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const { bar, text } = bandColor(band);
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      <div className={cn("relative flex-1 rounded-full bg-[rgb(var(--overlay-hover)/0.07)] overflow-hidden", size === "sm" ? "h-1" : "h-1.5")}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-400", bar)}
          style={{ width: `${Math.max(4, Math.min(100, value))}%` }}
        />
      </div>
      {showLabel && <span className={cn("font-mono tabular-nums text-[11px] font-medium", text)}>{value}%</span>}
    </div>
  );
}

export function ConfidenceRing({ value, band, size = 44 }: { value: number; band: AIConfidenceBand; size?: number }) {
  const { text, ring } = bandColor(band);
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          className="stroke-[rgb(var(--overlay-hover)/0.08)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset] duration-400", ring)}
        />
      </svg>
      <span className={cn("absolute font-mono tabular-nums text-[11px] font-semibold", text)}>{value}</span>
    </div>
  );
}
