"use client";

import { create } from "zustand";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "default" | "success" | "warning" | "critical";
}

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;

  theme: "dark" | "light";
  toggleTheme: () => void;

  motionPreference: "system" | "reduced" | "full";
  setMotionPreference: (v: UIState["motionPreference"]) => void;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  mobileNavOpen: false,
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),

  theme: "light",
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    if (typeof window !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
      window.localStorage.setItem("meridian:theme", next);
    }
  },

  motionPreference: "system",
  setMotionPreference: (v) => {
    set({ motionPreference: v });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("meridian:motion", v);
    }
  },

  toasts: [],
  pushToast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { ...t, id }] });
    if (typeof window !== "undefined") {
      window.setTimeout(() => get().dismissToast(id), 4200);
    }
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

interface AuthState {
  isAuthenticated: boolean;
  hydrated: boolean;
  hydrate: () => void;
  login: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  hydrated: false,
  hydrate: () => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("meridian:session");
    set({ isAuthenticated: v === "1", hydrated: true });
  },
  login: () => {
    if (typeof window !== "undefined") window.localStorage.setItem("meridian:session", "1");
    set({ isAuthenticated: true });
  },
  logout: () => {
    if (typeof window !== "undefined") window.localStorage.removeItem("meridian:session");
    set({ isAuthenticated: false });
  },
}));
