"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Menu, ScanLine, Search, Sun, Moon, LogOut, Settings, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore, useUIStore } from "@/lib/store";
import { useOnClickOutside } from "@/lib/hooks";
import { getSystemStatus, CURRENT_USER } from "@/lib/mock-data";

const STATUS_DOT: Record<string, string> = {
  operational: "bg-success",
  degraded: "bg-warning",
  offline: "bg-critical",
};

export function Header() {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  const [statusOpen, setStatusOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const statusRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(statusRef, () => setStatusOpen(false));
  useOnClickOutside(notifRef, () => setNotifOpen(false));
  useOnClickOutside(profileRef, () => setProfileOpen(false));

  const statuses = getSystemStatus();
  const allOperational = statuses.every((s) => s.state === "operational");

  const notifications = [
    { title: "AI analysis complete", detail: "MRD-4821 · 3 findings flagged", time: "6m ago" },
    { title: "Report approved", detail: "MRD-3390 signed by Dr. Marsh", time: "41m ago" },
    { title: "STAT study queued", detail: "MRD-7213 — CT Head", time: "1h ago" },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-base/95 px-4 backdrop-blur">
      <button onClick={() => setMobileNavOpen(true)} className="rounded-md p-1.5 text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)] md:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-clinical/15 text-clinical">
          <ScanLine className="h-4 w-4" />
        </div>
      </Link>

      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden md:flex flex-1 max-w-md items-center gap-2.5 rounded-md border border-border-strong bg-panel-alt px-3 py-1.5 text-left text-[13px] text-ink-muted transition-colors hover:border-clinical/40"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1">Search patient, study ID, modality...</span>
        <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>

      <button onClick={() => setCommandPaletteOpen(true)} className="ml-auto rounded-md p-2 text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)] md:hidden">
        <Search className="h-[18px] w-[18px]" />
      </button>

      <div className="ml-auto hidden items-center gap-1.5 md:flex">
        {/* System status */}
        <div className="relative" ref={statusRef}>
          <button
            onClick={() => setStatusOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)]"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", allOperational ? "bg-success animate-heartbeat" : "bg-warning")} />
            {allOperational ? "All systems operational" : "Degraded"}
            <ChevronDown className="h-3 w-3" />
          </button>
          <AnimatePresence>
            {statusOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-64 rounded-lg border border-border-strong bg-elevated p-1.5 shadow-elevated"
              >
                {statuses.map((s) => (
                  <div key={s.name} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px]">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s.state])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink-primary">{s.name}</p>
                      <p className="text-[11px] text-ink-muted">{s.detail}</p>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={toggleTheme} className="rounded-md p-2 text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)]" aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative rounded-md p-2 text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)]"
            aria-label="Notifications"
          >
            <Bell className="h-[17px] w-[17px]" />
            <span className="absolute right-1.5 top-1.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-clinical animate-pulse-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-clinical" />
            </span>
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-80 rounded-lg border border-border-strong bg-elevated shadow-elevated"
              >
                <div className="border-b border-border px-4 py-3 text-[12px] font-medium text-ink-primary">Notifications</div>
                {notifications.map((n, i) => (
                  <div key={i} className="border-b border-border px-4 py-3 last:border-0">
                    <p className="text-[12.5px] text-ink-primary">{n.title}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-secondary">{n.detail}</p>
                    <p className="mt-1 text-[10.5px] text-ink-muted">{n.time}</p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Profile */}
        <div className="relative ml-1" ref={profileRef}>
          <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-[rgb(var(--overlay-hover)/0.06)]">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ai/20 text-[11px] font-semibold text-ai-strong">
              {CURRENT_USER.initials}
            </div>
            <ChevronDown className="h-3 w-3 text-ink-muted" />
          </button>
          <AnimatePresence>
            {profileOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-56 rounded-lg border border-border-strong bg-elevated p-1.5 shadow-elevated"
              >
                <div className="px-2.5 py-2">
                  <p className="text-[13px] font-medium text-ink-primary">{CURRENT_USER.name}</p>
                  <p className="text-[11px] text-ink-muted">{CURRENT_USER.role}</p>
                </div>
                <div className="my-1 h-px bg-border" />
                <Link href="/settings" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.06)] hover:text-ink-primary">
                  <Settings className="h-3.5 w-3.5" /> Settings
                </Link>
                <button
                  onClick={() => {
                    logout();
                    router.push("/login");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-ink-secondary hover:bg-critical-dim hover:text-critical"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
