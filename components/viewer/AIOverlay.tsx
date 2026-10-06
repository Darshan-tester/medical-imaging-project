"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/hooks";

export function AIOverlay({
  findings,
  activeFindingId,
  onHover,
  onSelect,
  opacity = 1,
  visible = true,
}: {
  findings: Finding[];
  activeFindingId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  opacity?: number;
  visible?: boolean;
}) {
  const reduced = usePrefersReducedMotion();

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity }}>
      <AnimatePresence>
        {findings.map((f, i) => {
          const isActive = f.id === activeFindingId;
          const isNegative = f.label.toLowerCase().startsWith("no ");
          if (isNegative || f.status === "rejected") return null;

          // Clinical Semantic Colors (Section 3)
          let color = "#EAB308"; // Default Yellow: AI suggestion requiring review
          if (f.status === "accepted" || f.status === "confirmed") {
            color = "#22C55E"; // Green: Accepted / Verified
          } else if (f.isCritical) {
            color = "#EF4444"; // Red: Potentially urgent / high-priority finding
          } else if (f.band === "moderate" || f.confidenceLevel === "moderate") {
            color = "#F97316"; // Orange: Moderate confidence / needs attention
          }

          const confidenceText =
            f.status === "accepted"
              ? "✓ Accepted"
              : f.status === "modified"
              ? "✓ Modified"
              : f.confidenceLevel
              ? `${f.confidenceLevel} conf.`
              : f.band === "high"
              ? "high conf."
              : "moderate conf.";

          return (
            <motion.button
              key={f.id}
              initial={reduced ? undefined : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, delay: reduced ? 0 : i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={() => onHover(f.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(f.id)}
              className="pointer-events-auto absolute rounded-[3px]"
              style={{
                left: `${f.region.x * 100}%`,
                top: `${f.region.y * 100}%`,
                width: `${f.region.w * 100}%`,
                height: `${f.region.h * 100}%`,
                border: `1.5px solid ${color}`,
                boxShadow: isActive ? `0 0 0 2px ${color}33, 0 0 10px ${color}44` : "none",
                background: isActive ? `${color}18` : "transparent",
                transition: "box-shadow 150ms ease-out, background-color 150ms ease-out",
              }}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute -inset-1 rounded-[5px]"
                  style={{ boxShadow: `0 0 0 1.5px ${color}44`, background: "transparent" }}
                  aria-hidden
                />
              )}
              {/* corner reticles — reinforces the "AI-detected region" feel */}
              {(["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"] as const).map((pos) => (
                <span
                  key={pos}
                  className={cn("pointer-events-none absolute h-1.5 w-1.5 border-current", pos)}
                  style={{ color, borderWidth: pos.includes("top") ? "1.5px 0 0 1.5px" : "0 1.5px 1.5px 0", opacity: isActive ? 1 : 0.6 }}
                />
              ))}
              <span
                className={cn(
                  "absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white transition-opacity shadow-sm",
                  isActive ? "opacity-100" : "opacity-80"
                )}
                style={{ background: color }}
              >
                {f.label} · {confidenceText}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
