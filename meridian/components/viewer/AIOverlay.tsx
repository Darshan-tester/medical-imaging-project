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
}: {
  findings: Finding[];
  activeFindingId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence>
        {findings.map((f, i) => {
          const isActive = f.id === activeFindingId;
          const isNegative = f.label.toLowerCase().startsWith("no ");
          if (isNegative) return null;
          const color = f.band === "high" ? "#22C55E" : f.band === "moderate" ? "#F59E0B" : "#EF4444";
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
                boxShadow: isActive ? `0 0 0 3px ${color}2E, 0 0 14px ${color}66` : "none",
                background: isActive ? `${color}14` : "transparent",
                transition: "box-shadow 150ms ease-out, background-color 150ms ease-out",
              }}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute -inset-1 rounded-[5px] animate-glow-pulse"
                  style={{ boxShadow: `0 0 0 1.5px ${color}55`, background: "transparent" }}
                  aria-hidden
                />
              )}
              {/* corner reticles — reinforces the "AI-detected region" feel */}
              {(["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"] as const).map((pos) => (
                <span
                  key={pos}
                  className={cn("pointer-events-none absolute h-1.5 w-1.5 border-current", pos)}
                  style={{ color, borderWidth: pos.includes("top") ? "1.5px 0 0 1.5px" : "0 1.5px 1.5px 0", opacity: isActive ? 1 : 0.55 }}
                />
              ))}
              <span
                className={cn(
                  "absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-canvas transition-opacity",
                  isActive ? "opacity-100" : "opacity-70"
                )}
                style={{ background: color }}
              >
                {f.label} · {f.confidence}%
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
