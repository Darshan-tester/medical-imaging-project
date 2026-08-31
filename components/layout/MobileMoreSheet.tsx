"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, LogOut, Settings, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { usePrefersReducedMotion } from "@/lib/hooks";

export function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = usePrefersReducedMotion();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  const items = [
    { href: "/incident-report", label: "Incident Reports", icon: ShieldAlert },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            initial={{ y: reduced ? 0 : "100%" }}
            animate={{ y: 0 }}
            exit={{ y: reduced ? 0 : "100%" }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-border-strong bg-elevated pb-8 pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[rgb(var(--overlay-hover)/0.15)]" />
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={onClose} className="flex items-center gap-3 px-6 py-3.5 text-[14px] text-ink-primary">
                  <Icon className="h-[18px] w-[18px] text-ink-muted" />
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={() => {
                logout();
                onClose();
                router.push("/login");
              }}
              className="flex w-full items-center gap-3 px-6 py-3.5 text-[14px] text-critical"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Sign out
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
