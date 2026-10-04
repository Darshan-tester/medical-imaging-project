"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { Toaster } from "@/components/ui/Toaster";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Dedicated clinical reading room route: bypass portal shell to maximize image area
  const isStudyWorkspace = Boolean(
    pathname &&
    pathname.startsWith("/studies/") &&
    pathname !== "/studies"
  );

  if (isStudyWorkspace) {
    return (
      <div className="dark h-dvh w-full overflow-hidden bg-[#080c14] text-slate-100">
        <main className="h-full w-full overflow-hidden">{children}</main>
        <CommandPalette />
        <Toaster />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto pb-[76px] md:pb-0">{children}</main>
      </div>
      <MobileNav />
      <CommandPalette />
      <Toaster />
    </div>
  );
}

