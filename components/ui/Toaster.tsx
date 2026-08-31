"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const ICONS = {
  default: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  critical: TriangleAlert,
};

const TONE_CLASSES = {
  default: "text-clinical",
  success: "text-success",
  warning: "text-warning",
  critical: "text-critical",
};

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  const dismissToast = useUIStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border-strong bg-elevated px-4 py-3.5 shadow-elevated"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_CLASSES[t.tone])} />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-ink-primary">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[12px] text-ink-secondary">{t.description}</p>}
              </div>
              <button onClick={() => dismissToast(t.id)} className="text-ink-muted hover:text-ink-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
