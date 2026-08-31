"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Moon, Settings as SettingsIcon, Sun, UserRound, Waves } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore, useUIStore } from "@/lib/store";
import { CURRENT_USER } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

function OptionPill<T extends string>({ value, current, label, onClick }: { value: T; current: T; label: string; onClick: (v: T) => void }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={cn(
        "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        current === value ? "border-clinical/50 bg-clinical-dim text-clinical-strong" : "border-border-strong text-ink-secondary hover:text-ink-primary"
      )}
    >
      {label}
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const motionPreference = useUIStore((s) => s.motionPreference);
  const setMotionPreference = useUIStore((s) => s.setMotionPreference);
  const [notifications, setNotifications] = useState({ criticalFindings: true, reportApprovals: true, weeklyDigest: false });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-10">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <SettingsIcon className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-section-title text-ink-primary">Settings</h1>
          <p className="text-[12.5px] text-ink-secondary">Manage your profile, appearance, and workspace preferences.</p>
        </div>
      </div>

      <div className="mt-7 space-y-5">
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center gap-2 text-ink-secondary">
            <UserRound className="h-4 w-4" />
            <h3 className="text-[13px] font-semibold text-ink-primary">Profile</h3>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ai/20 text-[13px] font-semibold text-ai-strong">
              {CURRENT_USER.initials}
            </div>
            <div>
              <p className="text-[13.5px] font-medium text-ink-primary">{CURRENT_USER.name}</p>
              <p className="text-[11.5px] text-ink-muted">{CURRENT_USER.role}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center gap-2 text-ink-secondary">
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <h3 className="text-[13px] font-semibold text-ink-primary">Appearance</h3>
          </div>
          <p className="mt-1 text-[12px] text-ink-secondary">Dark is the primary clinical experience; light mode is also fully supported.</p>
          <div className="mt-3 flex gap-2">
            <OptionPill value="dark" current={theme} label="Dark" onClick={() => theme !== "dark" && toggleTheme()} />
            <OptionPill value="light" current={theme} label="Light" onClick={() => theme !== "light" && toggleTheme()} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center gap-2 text-ink-secondary">
            <Waves className="h-4 w-4" />
            <h3 className="text-[13px] font-semibold text-ink-primary">Motion &amp; Accessibility</h3>
          </div>
          <p className="mt-1 text-[12px] text-ink-secondary">Controls 3D visualization movement and interface animation throughout Meridian.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <OptionPill value="system" current={motionPreference} label="Match System" onClick={setMotionPreference} />
            <OptionPill value="full" current={motionPreference} label="Full Motion" onClick={setMotionPreference} />
            <OptionPill value="reduced" current={motionPreference} label="Reduced Motion" onClick={setMotionPreference} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center gap-2 text-ink-secondary">
            <Bell className="h-4 w-4" />
            <h3 className="text-[13px] font-semibold text-ink-primary">Notifications</h3>
          </div>
          <div className="mt-3 space-y-3">
            {(
              [
                ["criticalFindings", "Critical findings", "STAT priority studies and high-severity incidents"],
                ["reportApprovals", "Report approvals", "When a report you're following is signed"],
                ["weeklyDigest", "Weekly digest", "Summary of workspace activity every Monday"],
              ] as const
            ).map(([key, label, desc]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-4">
                <div>
                  <p className="text-[12.5px] font-medium text-ink-primary">{label}</p>
                  <p className="text-[11px] text-ink-muted">{desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={(e) => setNotifications((n) => ({ ...n, [key]: e.target.checked }))}
                  className="h-4 w-4 shrink-0 rounded border-border-strong accent-clinical"
                />
              </label>
            ))}
          </div>
        </section>

        <Button
          variant="outline"
          size="md"
          onClick={() => {
            logout();
            router.push("/login");
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
