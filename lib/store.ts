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

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  npi?: string;
  department?: string;
}

export const DEFAULT_CLINICAL_USER: AuthUser = {
  id: "usr-chen",
  name: "Dr. Amara Chen",
  role: "Attending Radiologist",
  npi: "1849204918",
  department: "Diagnostic Radiology & Thoracic Imaging",
};

interface AuthState {
  isAuthenticated: boolean;
  hydrated: boolean;
  user: AuthUser;
  hydrate: () => void;
  login: (customUser?: Partial<AuthUser>) => void;
  logout: () => void;
  setUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  hydrated: false,
  user: DEFAULT_CLINICAL_USER,
  hydrate: () => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("meridian:session");
    const storedUser = window.localStorage.getItem("meridian:user");
    set({
      isAuthenticated: v === "1",
      hydrated: true,
      user: storedUser ? JSON.parse(storedUser) : DEFAULT_CLINICAL_USER,
    });
  },
  login: (customUser) => {
    const userToSave = { ...DEFAULT_CLINICAL_USER, ...customUser };
    if (typeof window !== "undefined") {
      window.localStorage.setItem("meridian:session", "1");
      window.localStorage.setItem("meridian:user", JSON.stringify(userToSave));
    }
    set({ isAuthenticated: true, user: userToSave });
  },
  logout: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("meridian:session");
      window.localStorage.removeItem("meridian:user");
    }
    set({ isAuthenticated: false, user: DEFAULT_CLINICAL_USER });
  },
  setUser: (user) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("meridian:user", JSON.stringify(user));
    }
    set({ user });
  },
}));
