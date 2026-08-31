"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  ChevronsLeft,
  LayoutDashboard,
  FileText,
  Settings,
  ShieldAlert,
  UploadCloud,
  LogOut,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore, useAuthStore } from "@/lib/store";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { Tooltip } from "@/components/ui/Tooltip";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/studies", label: "Studies", icon: Activity },
  { href: "/upload", label: "Upload Scan", icon: UploadCloud },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/incident-report", label: "Incident Reports", icon: ShieldAlert },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const reduced = usePrefersReducedMotion();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 236 }}
      transition={{ duration: reduced ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="hidden md:flex h-full shrink-0 flex-col border-r border-border bg-base"
    >
      <div className={cn("flex h-14 items-center border-b border-border px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-clinical/15 text-clinical">
            <span className="absolute inset-0 rounded-md bg-clinical/20 animate-glow-pulse" aria-hidden />
            <ScanLine className="relative h-4 w-4" strokeWidth={2.25} />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-ink-primary">Meridian</p>
              <p className="truncate text-[10px] text-ink-muted">Vedh Medical Imaging</p>
            </div>
          )}
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-4">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const link = (
            <Link
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                collapsed && "justify-center px-0",
                active ? "bg-clinical-dim text-clinical-strong" : "text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.05)] hover:text-ink-primary"
              )}
            >
              {active && !collapsed && <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-clinical" />}
              <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
          return (
            <div key={item.href}>
              {collapsed ? (
                <Tooltip label={item.label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-2.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-[rgb(var(--overlay-hover)/0.05)] hover:text-ink-primary",
            collapsed && "justify-center px-0"
          )}
        >
          <Settings className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
          {!collapsed && <span>Settings</span>}
        </Link>
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className={cn(
            "mt-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-critical-dim hover:text-critical",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          onClick={toggleSidebar}
          className={cn(
            "mt-1.5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-[12px] text-ink-muted transition-colors hover:bg-[rgb(var(--overlay-hover)/0.05)] hover:text-ink-primary",
            collapsed && "justify-center px-0"
          )}
        >
          <ChevronsLeft className={cn("h-4 w-4 shrink-0 transition-transform duration-250", collapsed && "rotate-180")} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </motion.aside>
  );
}
