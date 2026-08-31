"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { ScanLine } from "lucide-react";

export default function RootPage() {
  const router = useRouter();
  const { hydrate, hydrated, isAuthenticated } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    router.replace(isAuthenticated ? "/dashboard" : "/login");
  }, [hydrated, isAuthenticated, router]);

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <ScanLine className="h-6 w-6 animate-pulse" />
        </div>
        <p className="text-[13px] text-ink-muted">Loading Meridian…</p>
      </div>
    </div>
  );
}
