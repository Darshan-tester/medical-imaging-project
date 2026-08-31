import { cn } from "@/lib/utils";

/**
 * Animated EKG / heartbeat trace. Purely decorative — reinforces the
 * clinical brand without competing with real data. Respects
 * prefers-reduced-motion globally (see globals.css).
 */
export function HeartbeatLine({
  className,
  strokeClassName = "stroke-clinical",
  width = 240,
  height = 48,
}: {
  className?: string;
  strokeClassName?: string;
  width?: number;
  height?: number;
}) {
  const path =
    "M0 24 H30 L38 24 L44 8 L52 40 L60 4 L68 32 L74 24 L82 24 L90 16 L96 24 H240";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={path} fill="none" className={cn("opacity-20", strokeClassName)} strokeWidth={1.5} />
      <path
        d={path}
        fill="none"
        className={cn("ecg-path", strokeClassName)}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A pulsing status dot with an expanding "ping" ring — used for live /
 * operational / monitoring indicators (system status, active AI jobs).
 */
export function VitalDot({
  tone = "success",
  className,
  size = "sm",
}: {
  tone?: "success" | "clinical" | "warning" | "critical";
  className?: string;
  size?: "sm" | "md";
}) {
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const toneClass = {
    success: "bg-success",
    clinical: "bg-clinical",
    warning: "bg-warning",
    critical: "bg-critical",
  }[tone];
  return (
    <span className={cn("relative inline-flex", dotSize, className)}>
      <span className={cn("absolute inline-flex h-full w-full rounded-full animate-pulse-ring", toneClass)} />
      <span className={cn("relative rounded-full animate-heartbeat", dotSize, toneClass)} />
    </span>
  );
}

/**
 * Soft breathing glow wrapper for AI / neural-analysis elements —
 * a subtle "thinking" halo rather than a literal spinner.
 */
export function AiGlow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <span className="absolute inset-0 rounded-full bg-ai/25 blur-md animate-glow-pulse" aria-hidden />
      <span className="relative">{children}</span>
    </div>
  );
}
