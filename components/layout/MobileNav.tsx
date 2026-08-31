"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutDashboard, MoreHorizontal, UploadCloud, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/store";
import { MobileMoreSheet } from "./MobileMoreSheet";

const TABS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/studies", label: "Studies", icon: Activity },
  { href: "/upload", label: "Upload", icon: UploadCloud },
  { href: "/reports", label: "Reports", icon: FileText },
];

export function MobileNav() {
  const pathname = usePathname();
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-[60px] items-stretch border-t border-border bg-base/95 backdrop-blur md:hidden">
        {TABS.map((tab) => {
          const active = pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href));
          const Icon = tab.icon;
          return (
            <Link key={tab.href} href={tab.href} className="flex flex-1 flex-col items-center justify-center gap-1">
              <Icon className={cn("h-5 w-5", active ? "text-clinical" : "text-ink-muted")} strokeWidth={2} />
              <span className={cn("text-[10px] font-medium", active ? "text-clinical" : "text-ink-muted")}>{tab.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMobileNavOpen(true)} className="flex flex-1 flex-col items-center justify-center gap-1">
          <MoreHorizontal className="h-5 w-5 text-ink-muted" strokeWidth={2} />
          <span className="text-[10px] font-medium text-ink-muted">More</span>
        </button>
      </nav>
      <MobileMoreSheet open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </>
  );
}
