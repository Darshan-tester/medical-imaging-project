"use client";

import { Modal } from "@/components/ui/Modal";
import { Keyboard, Layers, Sliders, Crosshair, ZoomIn, Move, Ruler, RotateCcw, Play, Maximize } from "lucide-react";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: "Navigation & Slices",
    shortcuts: [
      { key: "↑ / ↓", description: "Previous / next slice in active series" },
      { key: "← / →", description: "Previous / next slice (alternative)" },
      { key: "Mouse Wheel", description: "Cine scroll through volumetric slices" },
      { key: "Space", description: "Toggle cine playback / pause" },
    ],
  },
  {
    title: "Tools & Modes",
    shortcuts: [
      { key: "W", description: "Activate Window / Level tool" },
      { key: "P", description: "Activate Pan tool" },
      { key: "Z", description: "Activate Zoom / Magnify tool" },
      { key: "M", description: "Activate Caliper Measurement tool" },
      { key: "A", description: "Activate ROI Annotation tool" },
      { key: "R", description: "Reset viewport zoom, pan, and W/L" },
      { key: "Esc", description: "Exit current tool / return to default pan" },
    ],
  },
  {
    title: "Display & Workstation",
    shortcuts: [
      { key: "F", description: "Toggle diagnostic reading room fullscreen" },
      { key: "?", description: "Open keyboard shortcuts help panel" },
    ],
  },
];

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Workstation Keyboard Shortcuts"
      description="Quick reference for standard radiology workstation shortcuts."
    >
      <div className="space-y-4 text-[12px]">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2">
            <h4 className="font-semibold text-ink-primary uppercase tracking-wider text-[11px] text-clinical">
              {group.title}
            </h4>
            <div className="rounded-lg border border-border bg-panel-alt divide-y divide-border/60">
              {group.shortcuts.map((s) => (
                <div key={s.key} className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink-secondary">{s.description}</span>
                  <kbd className="rounded border border-border-strong bg-base px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-primary shadow-xs">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="pt-2 border-t border-border/60 text-[11px] text-ink-muted">
          Tip: Shortcuts are active during 2D and MPR review when not typing in text fields.
        </div>
      </div>
    </Modal>
  );
}
