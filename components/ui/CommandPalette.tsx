"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  ShieldAlert,
  UploadCloud,
  BarChart3,
  CornerDownLeft,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/lib/store";
import { listStudies } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/hooks";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  group: string;
  onSelect: (router: ReturnType<typeof useRouter>) => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const router = useRouter();
  const reduced = usePrefersReducedMotion();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const staticActions: Action[] = useMemo(
    () => [
      { id: "dashboard", label: "Go to Dashboard", icon: LayoutDashboard, group: "Navigate", onSelect: (r) => r.push("/dashboard") },
      { id: "studies", label: "Go to Studies", icon: Activity, group: "Navigate", onSelect: (r) => r.push("/studies") },
      { id: "upload", label: "Upload Scan", icon: UploadCloud, group: "Actions", onSelect: (r) => r.push("/upload") },
      { id: "reports", label: "Go to Reports", icon: FileText, group: "Navigate", onSelect: (r) => r.push("/reports") },
      { id: "incident", label: "Create Incident Report", icon: ShieldAlert, group: "Actions", onSelect: (r) => r.push("/incident-report") },
      { id: "analytics", label: "Go to Analytics", icon: BarChart3, group: "Navigate", onSelect: (r) => r.push("/analytics") },
      { id: "settings", label: "Go to Settings", icon: Settings, group: "Navigate", onSelect: (r) => r.push("/settings") },
    ],
    []
  );

  const studyActions: Action[] = useMemo(
    () =>
      listStudies()
        .slice(0, 8)
        .map((s) => ({
          id: s.id,
          label: `${s.studyId} — ${s.patientAlias}`,
          hint: `${s.modality} · ${s.bodyRegion}`,
          icon: Search,
          group: "Open Study",
          onSelect: (r) => r.push(`/studies/${s.id}`),
        })),
    []
  );

  const all = [...staticActions, ...studyActions];
  const filtered = query.trim()
    ? all.filter((a) => (a.label + " " + (a.hint ?? "")).toLowerCase().includes(query.toLowerCase()))
    : all;

  const groups = filtered.reduce<Record<string, Action[]>>((acc, a) => {
    (acc[a.group] ||= []).push(a);
    return acc;
  }, {});

  useEffect(() => setActiveIndex(0), [query]);

  const flat = filtered;

  const runAction = (a: Action) => {
    a.onSelect(router);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[activeIndex]) runAction(flat[activeIndex]);
    }
  };

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : -8, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.98 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border-strong bg-elevated shadow-elevated"
            role="dialog"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <Search className="h-4 w-4 text-ink-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search patient, study ID, or run a command..."
                className="flex-1 bg-transparent text-[14px] text-ink-primary placeholder:text-ink-muted outline-none"
              />
              <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-ink-muted">ESC</kbd>
            </div>

            <div className="max-h-[360px] overflow-y-auto py-2">
              {Object.entries(groups).length === 0 && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-secondary">No matching commands or studies.</p>
              )}
              {Object.entries(groups).map(([group, actions]) => (
                <div key={group} className="mb-1">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{group}</p>
                  {actions.map((a) => {
                    runningIndex += 1;
                    const isActive = runningIndex === activeIndex;
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.id}
                        onMouseEnter={() => setActiveIndex(runningIndex)}
                        onClick={() => runAction(a)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors",
                          isActive ? "bg-clinical-dim text-ink-primary" : "text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.04)]"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                        <span className="flex-1 truncate">{a.label}</span>
                        {a.hint && <span className="text-[11px] text-ink-muted">{a.hint}</span>}
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-clinical" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
