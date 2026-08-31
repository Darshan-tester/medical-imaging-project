"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useAuthStore, useUIStore } from "@/lib/store";
import { ScanLine } from "lucide-react";

export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hydrate, hydrated, isAuthenticated } = useAuthStore();

  useEffect(() => {
    hydrate();
    try {
      const storedTheme = window.localStorage.getItem("meridian:theme");
      if (storedTheme === "dark") useUIStore.setState({ theme: "dark" });
      const storedMotion = window.localStorage.getItem("meridian:motion") as "system" | "reduced" | "full" | null;
      if (storedMotion) useUIStore.setState({ motionPreference: storedMotion });
    } catch {
      /* localStorage unavailable — fall back to defaults */
    }
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !isAuthenticated) router.replace("/login");
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated || !isAuthenticated) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-canvas">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <ScanLine className="h-6 w-6 animate-pulse" />
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
