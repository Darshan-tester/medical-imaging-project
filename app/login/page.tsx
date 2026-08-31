"use client";

import dynamic from "next/dynamic";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/lib/store";

import { HeartbeatLine, VitalDot } from "@/components/ui/MedicalMotifs";

const MedicalScene = dynamic(() => import("@/components/three/MedicalScene").then((m) => m.MedicalScene), { ssr: false });

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Enter an email and password to continue.");
      return;
    }
    setError(null);
    setSubmitting(true);
    window.setTimeout(() => {
      login();
      router.push("/dashboard");
    }, 500);
  };

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Branding panel — deliberately kept as a rich clinical-dark hero so the
          glowing scan visualization reads well regardless of the active app theme. */}
      <div className="relative hidden w-1/2 overflow-hidden border-r border-border bg-[#0A0F1C] lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(circle at 30% 20%, rgba(59,130,246,0.22), transparent 55%)" }}
        />
        <div className="absolute inset-0">
          <MedicalScene />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0F1C] via-[#0A0F1C]/40 to-transparent" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-clinical/20 text-[#60A5FA]">
              <span className="absolute inset-0 rounded-md bg-clinical/25 animate-glow-pulse" aria-hidden />
              <ScanLine className="relative h-[18px] w-[18px]" />
            </div>
            <span className="text-[15px] font-semibold text-white">Meridian / Vedh Medical Imaging</span>
          </div>

          <div className="max-w-md">
            <div className="mb-5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[#60A5FA]">
              <VitalDot tone="clinical" /> Live diagnostic workspace
            </div>
            <h1 className="text-page-title text-white">Clinical precision, AI-accelerated.</h1>
            <p className="mt-4 text-[14px] leading-relaxed text-slate-300">
              A unified workspace for study triage, AI-assisted analysis, and radiologist reporting — built for the pace of a real
              reading room.
            </p>
            <HeartbeatLine className="mt-6 w-full max-w-[280px]" strokeClassName="stroke-[#60A5FA]" height={36} />
            <div className="mt-6 flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-[13px] text-slate-300">
                <ShieldCheck className="h-4 w-4 text-[#60A5FA]" /> Every AI finding requires radiologist sign-off before use.
              </div>
              <div className="flex items-center gap-2.5 text-[13px] text-slate-300">
                <Sparkles className="h-4 w-4 text-[#60A5FA]" /> Demo environment — synthetic studies, no real patient data.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-clinical/15 text-clinical">
              <ScanLine className="h-[18px] w-[18px]" />
            </div>
            <span className="text-[15px] font-semibold text-ink-primary">Meridian / Vedh Medical Imaging</span>
          </div>

          <h2 className="text-section-title text-ink-primary">Sign in to your workspace</h2>
          <p className="mt-1.5 text-[13px] text-ink-secondary">Demo environment — any email and password will sign you in.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Email</label>
              <Input type="email" placeholder="you@hospital.org" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-[12.5px] text-critical">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-[12px] text-ink-muted">
            By continuing you acknowledge this is a demo workspace with synthetic data only.
          </p>
        </div>
      </div>
    </div>
  );
}
