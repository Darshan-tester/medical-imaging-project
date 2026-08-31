import type { Config } from "tailwindcss";

// All theme-sensitive colors below resolve through CSS variables defined in
// globals.css (":root" = light / default, ".dark" = night reading-room mode).
// This means every existing `bg-panel`, `text-ink-primary`, `bg-clinical/15`,
// `border-border` etc. usage across the app automatically repaints for the
// active theme — no per-component dark: sweeping required.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---- Clinical hospital theme (light = default) ---------------------
        // Crisp, trustworthy, high-contrast — the way a real hospital
        // reading-room / EHR dashboard reads: white surfaces, quiet blue-grey
        // canvas, and deliberate blue / green / red signal colors.
        canvas: v("--color-canvas"),
        base: v("--color-base"),
        elevated: v("--color-elevated"),
        // Dedicated near-black for the diagnostic image viewer, so the
        // image itself is the brightest, most important thing on screen.
        // Intentionally theme-invariant — PACS viewers stay dark always.
        viewer: "#0A0E16",
        panel: {
          DEFAULT: v("--color-panel"),
          alt: v("--color-panel-alt"), // recessed control wells: inputs, toolbars, search
          hover: v("--color-panel-hover"),
        },
        border: {
          DEFAULT: v("--color-border"),
          strong: v("--color-border-strong"),
        },
        ink: {
          primary: v("--color-ink-primary"),
          secondary: v("--color-ink-secondary"),
          muted: v("--color-ink-muted"),
          disabled: v("--color-ink-disabled"),
        },
        // Primary clinical accent — hospital blue, used for active nav,
        // selected states, focus rings, primary controls, IV/monitor lines.
        clinical: {
          DEFAULT: v("--color-clinical"),
          dim: `rgb(var(--color-clinical) / 0.12)`,
          strong: v("--color-clinical-strong"),
        },
        // AI-specific indicator. Same blue family as primary — AI content
        // reads as part of the trusted clinical system, distinguished by
        // iconography (sparkle glyph, badge copy) rather than a competing hue.
        ai: {
          DEFAULT: v("--color-clinical"),
          dim: `rgb(var(--color-clinical) / 0.12)`,
          strong: v("--color-clinical-strong"),
        },
        // Secondary informational teal — metadata, secondary chart series.
        secondary: {
          DEFAULT: v("--color-secondary"),
          dim: `rgb(var(--color-secondary) / 0.12)`,
          strong: v("--color-secondary-strong"),
        },
        // Vitals green — approvals, healthy ranges, completed states.
        success: {
          DEFAULT: v("--color-success"),
          dim: `rgb(var(--color-success) / 0.12)`,
          strong: v("--color-success-strong"),
        },
        warning: {
          DEFAULT: v("--color-warning"),
          dim: `rgb(var(--color-warning) / 0.12)`,
          strong: v("--color-warning-strong"),
        },
        // Emergency / STAT red — critical findings, alerts, incident severity.
        critical: {
          DEFAULT: v("--color-critical"),
          dim: `rgb(var(--color-critical) / 0.12)`,
          strong: v("--color-critical-strong"),
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "page-title": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" }],
        "section-title": ["1.375rem", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        "card-title": ["1rem", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.55" }],
        meta: ["0.75rem", { lineHeight: "1.4" }],
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.5)",
        elevated: "0 12px 32px -8px rgba(0,0,0,0.55)",
        focus: "0 0 0 2px rgb(var(--color-canvas)), 0 0 0 4px rgb(var(--color-clinical))",
        // Soft, light-mode-native card shadow — the "white card on pale
        // canvas" look of a real hospital dashboard.
        clinic: "0 1px 2px 0 rgba(15,23,42,0.04), 0 8px 20px -8px rgba(15,23,42,0.10)",
      },
      transitionDuration: {
        150: "150ms",
        250: "250ms",
        400: "400ms",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.9" },
          "70%": { transform: "scale(1.9)", opacity: "0" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        // ---- Medical motif animations --------------------------------------
        // Two-beat "lub-dub" cardiac pulse for live/vital indicators.
        heartbeat: {
          "0%, 100%": { transform: "scale(1)" },
          "14%": { transform: "scale(1.18)" },
          "28%": { transform: "scale(1)" },
          "42%": { transform: "scale(1.12)" },
          "70%": { transform: "scale(1)" },
        },
        // Scrolling EKG trace — dash offset sweeps the stroke across the path.
        "ecg-draw": {
          "0%": { strokeDashoffset: "1000" },
          "100%": { strokeDashoffset: "0" },
        },
        // Breathing halo used behind AI / neural elements.
        "glow-pulse": {
          "0%, 100%": { opacity: "0.45", transform: "scale(0.94)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        // Slow vertical sweep for a "live monitor scan-line" accent.
        "monitor-scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "pulse-ring": "pulse-ring 2200ms cubic-bezier(0.2,0.6,0.4,1) infinite",
        shimmer: "shimmer 1.8s linear infinite",
        heartbeat: "heartbeat 1.8s ease-in-out infinite",
        "ecg-draw": "ecg-draw 2.6s linear infinite",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "monitor-scan": "monitor-scan 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
