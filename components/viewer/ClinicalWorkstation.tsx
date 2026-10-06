"use client";

import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import {
  Layers,
  Sparkles,
  MapPin,
  FileText,
  Pencil,
  Box,
  Boxes,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Move,
  Sliders,
  Scissors,
  Eye,
  EyeOff,
  Sun,
  Flame,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Circle,
  Type,
  Compass,
  ArrowUpRight,
  Target,
  Ruler,
  Info,
  Download,
  AlertTriangle,
  Grid2X2,
  Square,
  Crosshair,
} from "lucide-react";
import {
  Study,
  SeriesInfo,
  Finding,
  Marker,
  ViewerMeasurement,
  ViewerAnnotation,
  ViewportLayout,
  Annotation3D,
  ColorMap3D,
  ReportSection,
  ViewerImage,
  FindingType,
} from "@/lib/types";
import { ClinicalTopBar, ClinicalWorkflowMode } from "./ClinicalTopBar";
import { ClinicalSeriesSidebar } from "./ClinicalSeriesSidebar";
import { ClinicalOrganPanel } from "./ClinicalOrganPanel";
import { ClinicalAIPanel } from "./ClinicalAIPanel";
import { Clinical4DControls } from "./Clinical4DControls";
import { ClinicalPetControls } from "./ClinicalPetControls";
import { ImageViewer } from "./ImageViewer";
import { MultiPlaneGrid } from "./MultiPlaneGrid";
import { SliceNavigator } from "./SliceNavigator";
import { ThumbnailStrip } from "./ThumbnailStrip";
import { FindingsPanel } from "./FindingsPanel";
import { MarkersPanel } from "./MarkersPanel";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { OrganMeshState } from "./AIAnalysisPanel";
import { DEFAULT_VIEWER_STATE, ViewerState } from "./ViewerToolbar";
import { AnnotationToolbar, BRUSH_WIDTH_PX, DEFAULT_ANNOTATION_COLOR, AnnotationBrushSize } from "./AnnotationToolbar";
import { AnnotationPanel } from "./AnnotationPanel";
import { RadiologyReportPanel } from "@/components/report/RadiologyReportPanel";
import { ReportEditor } from "@/components/report/ReportEditor";
import { ApprovalPanel } from "@/components/report/ApprovalPanel";
import { ExportButton } from "@/components/report/ExportButton";
import { Modal } from "@/components/ui/Modal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { SessionAnnotationStore } from "@/lib/annotation-store";
import { AuditTrail } from "@/lib/audit-trail";
import { useAuthStore, useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";

import { detectGenuine4D } from "@/lib/anatomy-state";

const Patient3DAnatomyViewer = dynamic(
  () => import("./Patient3DAnatomyViewer").then((m) => m.Patient3DAnatomyViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full flex-col items-center justify-center bg-black text-ink-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-clinical border-t-transparent" />
        <span className="mt-3 text-[12px] font-medium">Reconstructing Patient 3D Anatomy...</span>
      </div>
    ),
  }
);

const Patient4DCineViewer = dynamic(
  () => import("./Patient4DCineViewer").then((m) => m.Patient4DCineViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#080c14] text-ink-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-clinical border-t-transparent" />
        <span className="mt-3 text-[12px] font-medium">Verifying 4D Temporal Acquisition...</span>
      </div>
    ),
  }
);

// Window/Level presets
export const WINDOW_PRESETS: { id: string; label: string; window: number; level: number }[] = [
  { id: "lung", label: "Lung", window: 1500, level: -600 },
  { id: "soft_tissue", label: "Soft Tissue", window: 400, level: 40 },
  { id: "bone", label: "Bone", window: 2000, level: 450 },
  { id: "brain", label: "Brain", window: 80, level: 40 },
  { id: "abdomen", label: "Abdomen", window: 350, level: 40 },
  { id: "default", label: "Default / Reset", window: 1, level: 1 },
];

export interface ClinicalWorkstationProps {
  study: Study;
  initialMode?: ClinicalWorkflowMode;
  onUpdateFinding: (id: string, patch: Partial<Finding>) => void;
  onChangeSections: (sections: ReportSection) => void;
  onAppendFindingToReport: (text: string) => void;
  onApprove: () => void;
  allStudies?: Study[];
}

export function ClinicalWorkstation({
  study,
  initialMode = "images",
  onUpdateFinding,
  onChangeSections,
  onAppendFindingToReport,
  onApprove,
  allStudies,
}: ClinicalWorkstationProps) {
  const { user } = useAuthStore();
  const pushToast = useUIStore((s) => s.pushToast);
  const containerRef = useRef<HTMLDivElement>(null);

  // Workflow mode
  const [activeMode, setActiveMode] = useState<ClinicalWorkflowMode>(initialMode);
  const [activeSeriesId, setActiveSeriesId] = useState<string>(study.series[0]?.id ?? "");
  const [currentSlice, setCurrentSlice] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cineFps, setCineFps] = useState(8);
  const [layout, setLayout] = useState<ViewportLayout>("1x1");
  const [viewerState, setViewerState] = useState<ViewerState>(DEFAULT_VIEWER_STATE);
  const [annotatedView, setAnnotatedView] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 3D & 4D states
  const [view3DStyle, setView3DStyle] = useState<"mesh" | "raymarch">("mesh");
  const [showOriginalVolume, setShowOriginalVolume] = useState(true);
  const [threshold3D, setThreshold3D] = useState(0.2);
  const [density3D, setDensity3D] = useState(1.2);
  const [colormap3D, setColormap3D] = useState<ColorMap3D>("bone");
  const [enableClipping, setEnableClipping] = useState(false);
  const [clipDistance, setClipDistance] = useState(0.5);
  const [clipAxis, setClipAxis] = useState<"z" | "y" | "x">("z");

  // 4D states
  const [cinePhase, setCinePhase] = useState(0);
  const [cine4DPlaying, setCine4DPlaying] = useState(false);
  const [fps4D, setFps4D] = useState(4);
  const [cardiacMetrics, setCardiacMetrics] = useState<any>(null);

  // PET states
  const [petOpacity, setPetOpacity] = useState(0.65);
  const [petSuvMax, setPetSuvMax] = useState(15);
  const [petSuvMin, setPetSuvMin] = useState(0);
  const [petVisible, setPetVisible] = useState(true);
  const [petColormap, setPetColormap] = useState<"hotiron" | "rainbow" | "pet" | "grayscale">("hotiron");

  // Findings, Annotations, Markers, Organ meshes
  const [organMeshes, setOrganMeshes] = useState<OrganMeshState[]>([]);
  const [activeOrganId, setActiveOrganId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ViewerAnnotation[]>([]);
  const [measurements, setMeasurements] = useState<ViewerMeasurement[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [annotations3D, setAnnotations3D] = useState<Annotation3D[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);

  // Pen tool specifics
  const [brushColor, setBrushColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [brushSize, setBrushSize] = useState<AnnotationBrushSize>("medium");
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotateMenuOpen, setAnnotateMenuOpen] = useState(false);

  // Dedicated 2D & 3D Annotation Mode State
  const [annotationMode, setAnnotationMode] = useState<"2d" | "3d" | null>(null);
  const [activeFindingType, setActiveFindingType] = useState<FindingType>("Lesion");
  const [activeCustomLabel, setActiveCustomLabel] = useState<string>("");
  const [emphasizedAnnotationId, setEmphasizedAnnotationId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ViewerAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<ViewerAnnotation[][]>([]);
  const [right3DSubTab, setRight3DSubTab] = useState<"anatomy" | "annotations">("anatomy");

  // Dialogs
  const [patientInfoOpen, setPatientInfoOpen] = useState(false);
  const [studyInfoOpen, setStudyInfoOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rightSubTab, setRightSubTab] = useState<"tools" | "findings" | "annotations">("tools");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Determine active series with fallback
  const activeSeries = useMemo(() => {
    const found = study.series.find((s) => s.id === activeSeriesId);
    return found || study.series[0] || ({
      id: "fallback",
      label: "Diagnostic Series",
      sliceCount: 1,
      orientation: "Axial",
    } as SeriesInfo);
  }, [study.series, activeSeriesId]);

  // Check if study has genuine 4D temporal information (never fabricated for static CT/MRI)
  const hasGenuine4D = useMemo(() => {
    return detectGenuine4D(study).hasTemporal;
  }, [study]);

  // Image index lookup
  const imageByIndex = useMemo(() => {
    const map = new Map<number, ViewerImage>();
    for (const img of activeSeries.images ?? []) map.set(img.index, img);
    return map;
  }, [activeSeries]);

  const imageUrlAt = useCallback(
    (index: number) => {
      const match = imageByIndex.get(index);
      if (match?.imageUrl) return match.imageUrl;
      if (study.imageUrls && study.imageUrls.length > 0) {
        return study.imageUrls[index % study.imageUrls.length];
      }
      return undefined;
    },
    [imageByIndex, study.imageUrls]
  );

  const activeImageUrl = imageUrlAt(currentSlice);
  const isDatasetStudy = Boolean(study.datasetSource);
  const hasImageData = !isDatasetStudy || Boolean(activeImageUrl);

  // Slice clamping on series switch
  useEffect(() => {
    const maxSlice = Math.max(0, (activeSeries.sliceCount || 1) - 1);
    if (currentSlice > maxSlice) {
      setCurrentSlice(maxSlice);
    }
  }, [activeSeries, currentSlice]);

  // Intelligent slice preloading: pre-caches adjacent ±4 slices into browser cache
  useEffect(() => {
    if (!activeSeries.sliceCount || activeSeries.sliceCount <= 1) return;
    const preloadRadius = 4;
    const preloadedImages: HTMLImageElement[] = [];

    for (let offset = -preloadRadius; offset <= preloadRadius; offset++) {
      if (offset === 0) continue;
      const idx = currentSlice + offset;
      if (idx >= 0 && idx < activeSeries.sliceCount) {
        const url = imageUrlAt(idx);
        if (url && typeof Image !== "undefined") {
          const img = new Image();
          img.src = url;
          preloadedImages.push(img);
        }
      }
    }

    return () => {
      preloadedImages.length = 0;
    };
  }, [currentSlice, activeSeries.sliceCount, imageUrlAt]);

  // Hydrate annotations from session store
  useEffect(() => {
    const saved = SessionAnnotationStore.load(study.id);
    if (saved) {
      if (saved.markers?.length) setMarkers(saved.markers);
      if (saved.measurements?.length) setMeasurements(saved.measurements);
      if (saved.annotations?.length) setAnnotations(saved.annotations);
      if (saved.annotations3D?.length) setAnnotations3D(saved.annotations3D);
    } else {
      setMarkers([]);
      setMeasurements([]);
      setAnnotations([]);
      setAnnotations3D([]);
    }
    setUndoStack([]);
    setRedoStack([]);
  }, [study.id]);

  // Debounced auto-save
  useEffect(() => {
    const timer = setTimeout(() => {
      SessionAnnotationStore.save({
        studyId: study.id,
        updatedAt: new Date().toISOString(),
        annotations,
        measurements,
        markers,
        annotations3D,
        findings: study.findings,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [study.id, annotations, measurements, markers, annotations3D, study.findings]);

  // Load derived 3D segments / 4D motion if available
  useEffect(() => {
    let cancelled = false;

    // Fetch initial segmentation if empty
    fetch(`/api/studies/${encodeURIComponent(study.id)}/analysis`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0 && organMeshes.length === 0) {
          const loaded: OrganMeshState[] = data.segments.map((seg: any) => ({
            id: seg.id,
            name: seg.name,
            group: seg.group || "organ",
            color: seg.color || "#38BDF8",
            opacity: 0.75,
            visible: true,
            isolated: false,
            volumeMl: seg.volumeMl,
            maxDiameterMm: seg.maxDiameterMm,
          }));
          setOrganMeshes(loaded);
        } else if (organMeshes.length === 0) {
          // Initialize structures tailored to active study body region
          const isHead = (study.bodyRegion || "").toUpperCase().includes("HEAD") ||
            (study.bodyRegion || "").toUpperCase().includes("BRAIN") ||
            (activeSeries.label || "").toLowerCase().includes("brain") ||
            (activeSeries.label || "").toLowerCase().includes("head");
          if (isHead) {
            setOrganMeshes([
              { id: "skull", name: "Skull & Calvarium", group: "bone", color: "#F1F5F9", opacity: 0.85, visible: true, isolated: false, volumeMl: 650.0 },
              { id: "brain", name: "Brain Parenchyma", group: "organ", color: "#F472B6", opacity: 0.75, visible: true, isolated: false, volumeMl: 1350.0 },
              { id: "ventricles", name: "Ventricular System (CSF)", group: "organ", color: "#38BDF8", opacity: 0.8, visible: true, isolated: false, volumeMl: 32.5 },
              { id: "vessels", name: "Intracranial Vasculature", group: "vessel", color: "#EF4444", opacity: 0.9, visible: false, isolated: false, volumeMl: 18.2 },
            ]);
          } else if ((study.bodyRegion || "").toUpperCase().includes("CHEST")) {
            setOrganMeshes([
              { id: "lungs", name: "Lungs Bilateral", group: "organ", color: "#06B6D4", opacity: 0.75, visible: true, isolated: false, volumeMl: 4200.0 },
              { id: "heart", name: "Heart & Pericardium", group: "cardiac", color: "#F43F5E", opacity: 0.8, visible: true, isolated: false, volumeMl: 780.0 },
              { id: "spine_ribs", name: "Thoracic Ribs & Spine", group: "bone", color: "#E2E8F0", opacity: 0.85, visible: true, isolated: false, volumeMl: 1100.0 },
              { id: "aorta", name: "Thoracic Aorta", group: "vessel", color: "#DC2626", opacity: 0.9, visible: false, isolated: false, volumeMl: 185.0 },
            ]);
          }
        }
        if (data.metrics?.cardiac) {
          setCardiacMetrics(data.metrics.cardiac);
        }
      })
      .catch(() => {
        if (!cancelled && organMeshes.length === 0) {
          const isHead = (study.bodyRegion || "").toUpperCase().includes("HEAD") ||
            (study.bodyRegion || "").toUpperCase().includes("BRAIN") ||
            (activeSeries.label || "").toLowerCase().includes("brain") ||
            (activeSeries.label || "").toLowerCase().includes("head");
          if (isHead) {
            setOrganMeshes([
              { id: "skull", name: "Skull & Calvarium", group: "bone", color: "#F1F5F9", opacity: 0.85, visible: true, isolated: false, volumeMl: 650.0 },
              { id: "brain", name: "Brain Parenchyma", group: "organ", color: "#F472B6", opacity: 0.75, visible: true, isolated: false, volumeMl: 1350.0 },
              { id: "ventricles", name: "Ventricular System (CSF)", group: "organ", color: "#38BDF8", opacity: 0.8, visible: true, isolated: false, volumeMl: 32.5 },
              { id: "vessels", name: "Intracranial Vasculature", group: "vessel", color: "#EF4444", opacity: 0.9, visible: false, isolated: false, volumeMl: 18.2 },
            ]);
          }
        }
      });

    // Fetch 4D motion metadata if applicable
    if (hasGenuine4D) {
      fetch(`/api/studies/${encodeURIComponent(study.id)}/derived/motion4d/motion_metadata.json`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          if (data.cardiacMetrics) {
            setCardiacMetrics(data.cardiacMetrics);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [study.id, hasGenuine4D, organMeshes.length]);

  // Cine loop for 2D slices
  useEffect(() => {
    if (!playing || activeSeries.sliceCount <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlice((prev) => (prev + 1) % activeSeries.sliceCount);
    }, 1000 / cineFps);
    return () => clearInterval(interval);
  }, [playing, activeSeries.sliceCount, cineFps]);

  // Cine loop for 4D phases
  useEffect(() => {
    if (!cine4DPlaying) return;
    const total = 8;
    const interval = setInterval(() => {
      setCinePhase((prev) => (prev + 1) % total);
    }, 1000 / fps4D);
    return () => clearInterval(interval);
  }, [cine4DPlaying, fps4D]);

  // Fullscreen handler
  const handleToggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Filter findings for active series & slice
  const visibleFindings = useMemo(() => {
    return study.findings.filter(
      (f) =>
        f.sliceIndex === currentSlice &&
        (!f.seriesId || f.seriesId === activeSeries.id)
    );
  }, [study.findings, currentSlice, activeSeries.id]);

  const overlayFindings = annotatedView ? visibleFindings : [];

  const currentMarkers = useMemo(() => {
    return markers.filter(
      (m) => m.seriesId === activeSeries.id && m.sliceIndex === currentSlice
    );
  }, [markers, activeSeries.id, currentSlice]);

  const currentMeasurements = useMemo(() => {
    return measurements.filter(
      (m) => m.seriesId === activeSeries.id && m.sliceIndex === currentSlice
    );
  }, [measurements, activeSeries.id, currentSlice]);

  const currentAnnotations = useMemo(() => {
    return annotations.filter(
      (a) => a.seriesId === activeSeries.id && a.sliceIndex === currentSlice
    );
  }, [annotations, activeSeries.id, currentSlice]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentSlice((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentSlice((prev) => Math.min(activeSeries.sliceCount - 1, prev + 1));
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "f" || e.key === "F") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handleToggleFullscreen();
        }
      } else if (e.key === "r" || e.key === "R") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState(DEFAULT_VIEWER_STATE);
        }
      } else if (e.key === "w" || e.key === "W") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState((s) => ({ ...s, tool: "window" }));
        }
      } else if (e.key === "p" || e.key === "P") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState((s) => ({ ...s, tool: "pan" }));
        }
      } else if (e.key === "z" || e.key === "Z") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState((s) => ({ ...s, tool: "zoom" }));
        }
      } else if (e.key === "m" || e.key === "M") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState((s) => ({ ...s, tool: "measure" }));
        }
      } else if (e.key === "a" || e.key === "A") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setViewerState((s) => ({ ...s, tool: "rect" }));
          setAnnotationMode("2d");
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === "Escape") {
        setViewerState((s) => ({ ...s, tool: "pan" }));
        setAnnotationMode(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSeries.sliceCount, handleToggleFullscreen]);

  const isAnnotationToolActive = [
    "pen",
    "rect",
    "circle",
    "polygon",
    "point",
    "annotate",
    "line",
    "angle",
    "text",
    "arrow",
    "measure",
  ].includes(viewerState.tool);

  // Dedicated Mode Switcher for 2D & 3D Annotation Workflows
  const handleSelectAnnotationMode = useCallback(
    (mode: "2d" | "3d") => {
      setAnnotationMode(mode);
      setRightPanelCollapsed(false);

      if (mode === "2d") {
        setActiveMode("images");
        setRightSubTab("annotations");
        setViewerState((s) => ({
          ...s,
          tool: isAnnotationToolActive ? s.tool : "rect",
        }));
        pushToast({
          title: "2D Annotation Mode Active",
          description: "Select an ROI tool (Box, Circle, Polygon, Contour, Caliper) to annotate abnormal regions.",
          tone: "default",
        });
      } else {
        setActiveMode("3d");
        setRight3DSubTab("annotations");
        pushToast({
          title: "3D Annotation Mode Active",
          description: "Visualizing 3D VOI spatial bounding highlights and anatomical regions linked to 2D ROIs.",
          tone: "default",
        });
      }
    },
    [isAnnotationToolActive, pushToast]
  );

  // Clinical Jump to 2D Image Evidence (from 3D viewer, marker, or annotation panel)
  const handleJumpTo2D = useCallback(
    (ann: ViewerAnnotation) => {
      setActiveMode("images");
      if (ann.seriesId && ann.seriesId !== activeSeries.id) {
        setActiveSeriesId(ann.seriesId);
      }
      if (ann.sliceIndex !== undefined) {
        setCurrentSlice(ann.sliceIndex);
      }

      // Calculate centroid of annotation points
      let cx = 0.5;
      let cy = 0.5;
      if (ann.points && ann.points.length > 0) {
        const sum = ann.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        cx = sum.x / ann.points.length;
        cy = sum.y / ann.points.length;
      } else if (ann.imageCoordinates) {
        cx = ann.imageCoordinates.x;
        cy = ann.imageCoordinates.y;
      }

      const targetZoom = Math.max(viewerState.zoom, 1.5);
      const targetPanX = (0.5 - cx) * 512 * targetZoom;
      const targetPanY = (0.5 - cy) * 512 * targetZoom;

      setViewerState((prev) => ({
        ...prev,
        zoom: targetZoom,
        panX: targetPanX,
        panY: targetPanY,
      }));

      setSelectedAnnotationId(ann.id);
      setEmphasizedAnnotationId(ann.id);
      setRightSubTab("annotations");

      setTimeout(() => {
        setEmphasizedAnnotationId((prev) => (prev === ann.id ? null : prev));
      }, 2500);

      pushToast({
        title: "Jumped to 2D Image Evidence",
        description: `Targeted Slice ${(ann.sliceIndex ?? 0) + 1} with centered zoom on ${ann.findingType || ann.finding || "finding"}.`,
        tone: "default",
      });
    },
    [activeSeries.id, viewerState.zoom, pushToast]
  );

  // 3D Region -> 2D Navigation
  const handleSelect3DMarker = useCallback(
    (findingId: string, sliceIdx: number, normX: number, normY: number, seriesId?: string) => {
      setActiveMode("images");
      if (seriesId && seriesId !== activeSeries.id) {
        setActiveSeriesId(seriesId);
      }
      setCurrentSlice(sliceIdx);

      const targetZoom = Math.max(viewerState.zoom, 1.5);
      const targetPanX = (0.5 - normX) * 512 * targetZoom;
      const targetPanY = (0.5 - normY) * 512 * targetZoom;

      setViewerState((prev) => ({
        ...prev,
        zoom: targetZoom,
        panX: targetPanX,
        panY: targetPanY,
      }));

      setSelectedFindingId(findingId);
      const linked = annotations.find(
        (a) =>
          a.id === findingId ||
          a.findingId === findingId ||
          (a.sliceIndex === sliceIdx && Math.abs((a.imageCoordinates?.x ?? a.points?.[0]?.x ?? 0.5) - normX) < 0.1)
      );

      if (linked) {
        setSelectedAnnotationId(linked.id);
        setEmphasizedAnnotationId(linked.id);
        setTimeout(() => {
          setEmphasizedAnnotationId((prev) => (prev === linked.id ? null : prev));
        }, 2500);
      }

      setRightSubTab("annotations");

      pushToast({
        title: "Navigated from 3D Anatomy",
        description: `Targeted lesion on Slice ${sliceIdx + 1} with centered ROI.`,
        tone: "default",
      });
    },
    [activeSeries.id, annotations, viewerState.zoom, pushToast]
  );

  const handleUndoAnnotation = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, annotations]);
    setAnnotations(previous);
  }, [undoStack, annotations]);

  const handleRedoAnnotation = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, annotations]);
    setAnnotations(next);
  }, [redoStack, annotations]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full flex-col bg-base text-ink-primary select-none overflow-hidden",
        isFullscreen && "fixed inset-0 z-50 bg-black"
      )}
    >
      {/* 1. TOP BAR: Patient, Study, Status, Workflow Modes & Actions */}
      <ClinicalTopBar
        study={study}
        activeMode={activeMode}
        onSelectMode={(mode) => {
          setActiveMode(mode);
          setPlaying(false);
          setCine4DPlaying(false);
        }}
        annotationMode={annotationMode}
        onSelectAnnotationMode={handleSelectAnnotationMode}
        annotationCount={annotations.length}
        hasGenuine4D={hasGenuine4D}
        onOpenPatientInfo={() => setPatientInfoOpen(true)}
        onOpenStudyInfo={() => setStudyInfoOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onExport={() => {
          pushToast({
            title: "Exporting Diagnostic Package",
            description: `Compiling study ${study.studyId} with report & DICOM metadata...`,
            tone: "default",
          });
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        aiStatus={study.status === "processing" ? "processing" : "complete"}
        hasUnsavedReport={false}
      />

      {/* 2. MAIN WORKSPACE: Left Series Sidebar + Center Viewport + Right Context Panel */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Left Sidebar: Studies & Series Navigation */}
        {!isFullscreen && (
          leftSidebarCollapsed ? (
            <div className="w-9 shrink-0 h-full border-r border-border bg-panel flex flex-col items-center py-3 select-none">
              <button
                onClick={() => setLeftSidebarCollapsed(false)}
                className="rounded p-1.5 text-ink-muted hover:text-ink-primary hover:bg-base transition-colors"
                title="Expand Series Browser"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="mt-6 [writing-mode:vertical-rl] rotate-180 font-mono text-[10.5px] text-ink-secondary uppercase tracking-widest flex items-center gap-1.5">
                <span>Series ({study.series.length})</span>
              </div>
            </div>
          ) : (
            <div className="w-[240px] shrink-0 h-full border-r border-border bg-panel overflow-hidden flex flex-col relative">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-panel-alt">
                <span className="text-[11px] font-semibold text-ink-primary tracking-tight">Series Browser</span>
                <button
                  onClick={() => setLeftSidebarCollapsed(true)}
                  className="rounded p-1 text-ink-muted hover:text-ink-primary hover:bg-base transition-colors"
                  title="Collapse Series Browser"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </div>
              <ClinicalSeriesSidebar
                study={study}
                series={study.series}
                activeSeriesId={activeSeries.id}
                onSelectSeries={(id) => {
                  setActiveSeriesId(id);
                  setCurrentSlice(0);
                  setPlaying(false);
                }}
              />
            </div>
          )
        )}

        {/* Center Viewport Area: 2D/MPR, 3D, 4D, AI Workstation, or Report */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-black relative overflow-hidden">
          {/* Active Mode Renderer */}
          {activeMode === "images" && (
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Diagnostic Toolbar */}
              <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0d121c] px-3 py-1.5 text-[12px] text-gray-300 shrink-0 z-10">
                {/* Left tools: Layout & Primary Tools */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Layout Selector */}
                  <div className="flex items-center rounded border border-white/15 bg-black/40 p-0.5">
                    <Tooltip label="Single View (1x1)">
                      <button
                        onClick={() => setLayout("1x1")}
                        className={cn(
                          "rounded p-1 transition-colors",
                          layout === "1x1" ? "bg-clinical text-white font-semibold" : "text-gray-400 hover:text-white"
                        )}
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Multi-Planar Reconstruction (MPR 2x2)">
                      <button
                        onClick={() => setLayout("2x2")}
                        className={cn(
                          "rounded p-1 transition-colors",
                          layout === "2x2" ? "bg-clinical text-white font-semibold" : "text-gray-400 hover:text-white"
                        )}
                      >
                        <Grid2X2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>

                  <div className="h-4 w-[1px] bg-white/15 mx-0.5" />

                  {/* Primary Tools */}
                  <div className="flex items-center gap-0.5">
                    <Tooltip label="Window/Level adjustment (Drag left/right/up/down)">
                      <button
                        onClick={() => setViewerState((s) => ({ ...s, tool: "window" }))}
                        className={cn(
                          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                          viewerState.tool === "window" ? "bg-clinical text-white font-medium" : "text-gray-400 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <Sliders className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">W/L</span>
                      </button>
                    </Tooltip>

                    <Tooltip label="Pan viewport">
                      <button
                        onClick={() => setViewerState((s) => ({ ...s, tool: "pan" }))}
                        className={cn(
                          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                          viewerState.tool === "pan" ? "bg-clinical text-white font-medium" : "text-gray-400 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <Move className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">Pan</span>
                      </button>
                    </Tooltip>

                    <Tooltip label="Zoom in/out">
                      <button
                        onClick={() => setViewerState((s) => ({ ...s, tool: "zoom" }))}
                        className={cn(
                          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                          viewerState.tool === "zoom" ? "bg-clinical text-white font-medium" : "text-gray-400 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">Zoom</span>
                      </button>
                    </Tooltip>

                    <Tooltip label="Calibrated linear caliper measurement (mm)">
                      <button
                        onClick={() => setViewerState((s) => ({ ...s, tool: "measure" }))}
                        className={cn(
                          "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                          viewerState.tool === "measure" ? "bg-clinical text-white font-medium" : "text-gray-400 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <Scissors className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">Measure</span>
                      </button>
                    </Tooltip>

                    {/* Professional 2D Annotation Tool Selector */}
                    <div className="relative">
                      <div className="flex items-center rounded border border-white/15 bg-black/40">
                        <button
                          onClick={() => {
                            if (isAnnotationToolActive) {
                              setViewerState((s) => ({ ...s, tool: "window" }));
                            } else {
                              setViewerState((s) => ({ ...s, tool: "rect" }));
                            }
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium transition-colors rounded-l",
                            isAnnotationToolActive
                              ? "bg-clinical text-white font-semibold"
                              : "text-gray-300 hover:bg-white/10 hover:text-white"
                          )}
                          title="Toggle ROI Annotation mode"
                        >
                          {viewerState.tool === "rect" ? (
                            <>
                              <Square className="h-3.5 w-3.5 text-cyan-300" />
                              <span>Box ROI</span>
                            </>
                          ) : viewerState.tool === "annotate" ? (
                            <>
                              <Target className="h-3.5 w-3.5 text-amber-300" />
                              <span>Point</span>
                            </>
                          ) : viewerState.tool === "circle" ? (
                            <>
                              <Circle className="h-3.5 w-3.5 text-emerald-300" />
                              <span>Circle ROI</span>
                            </>
                          ) : viewerState.tool === "angle" ? (
                            <>
                              <Compass className="h-3.5 w-3.5 text-purple-300" />
                              <span>Angle</span>
                            </>
                          ) : viewerState.tool === "arrow" ? (
                            <>
                              <ArrowUpRight className="h-3.5 w-3.5 text-rose-300" />
                              <span>Arrow</span>
                            </>
                          ) : viewerState.tool === "text" ? (
                            <>
                              <Type className="h-3.5 w-3.5 text-sky-300" />
                              <span>Text</span>
                            </>
                          ) : (
                            <>
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Annotate</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setAnnotateMenuOpen((prev) => !prev)}
                          className={cn(
                            "px-1 py-1 text-gray-400 hover:text-white border-l border-white/10 transition-colors rounded-r",
                            annotateMenuOpen && "bg-white/15 text-white"
                          )}
                          title="Choose annotation shape (Bounding Box, Point, Freehand, Circle, Text)"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Dropdown Menu for choosing Annotation Shape */}
                      {annotateMenuOpen && (
                        <div
                          className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded-lg border border-[#1e293b] bg-[#0d121c]/95 p-1 shadow-2xl backdrop-blur-md"
                          onClick={() => setAnnotateMenuOpen(false)}
                        >
                          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 border-b border-[#1e293b] mb-1">
                            Diagnostic Markups
                          </div>
                          {[
                            { tool: "rect", label: "Box ROI (Lesion)", icon: Square, desc: "Draw box linked to 3D" },
                            { tool: "annotate", label: "Anatomical Point", icon: Target, desc: "Mark focal point / marker" },
                            { tool: "pen", label: "Freehand Pen", icon: Pencil, desc: "Contour / drawing stroke" },
                            { tool: "circle", label: "Circle ROI", icon: Circle, desc: "Circular region of interest" },
                            { tool: "measure", label: "Linear Caliper", icon: Scissors, desc: "Calibrated distance in mm" },
                            { tool: "angle", label: "Angle (3 Points)", icon: Compass, desc: "Cobb / anatomical angle" },
                            { tool: "arrow", label: "Pointer Arrow", icon: ArrowUpRight, desc: "Point to finding" },
                            { tool: "text", label: "Text Callout", icon: Type, desc: "Radiologist note on slice" },
                          ].map((item) => {
                            const Icon = item.icon;
                            const isSelected = viewerState.tool === item.tool;
                            return (
                              <button
                                key={item.tool}
                                onClick={() => {
                                  setViewerState((s) => ({ ...s, tool: item.tool as any }));
                                  setAnnotateMenuOpen(false);
                                }}
                                className={cn(
                                  "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors",
                                  isSelected
                                    ? "bg-clinical/20 text-clinical font-semibold"
                                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                                )}
                              >
                                <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                <div>
                                  <div className="leading-tight">{item.label}</div>
                                  <div className="text-[9.5px] font-normal text-slate-400 leading-tight">
                                    {item.desc}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="h-4 w-[1px] bg-white/15 mx-0.5" />

                  {/* Window/Level Presets */}
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 hidden lg:inline">Preset:</span>
                    <select
                      className="rounded border border-white/20 bg-black/60 px-2 py-0.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-clinical"
                      value={WINDOW_PRESETS.find((p) => p.window === viewerState.windowWidth && p.level === viewerState.windowCenter)?.id || "custom"}
                      onChange={(e) => {
                        const target = WINDOW_PRESETS.find((p) => p.id === e.target.value);
                        if (target) {
                          setViewerState((s) => ({
                            ...s,
                            windowWidth: target.window,
                            windowCenter: target.level,
                          }));
                        }
                      }}
                    >
                      {WINDOW_PRESETS.map((p) => (
                        <option key={p.id} value={p.id} className="bg-neutral-900 text-white">
                          {p.label}
                        </option>
                      ))}
                      <option value="custom" disabled className="bg-neutral-900 text-white">
                        Custom W/L
                      </option>
                    </select>
                  </div>
                </div>

                {/* Right tools: Invert, AI Overlay, Reset */}
                <div className="flex items-center gap-2">
                  <Tooltip label="Invert pixel brightness">
                    <button
                      onClick={() => setViewerState((s) => ({ ...s, inverted: !s.inverted }))}
                      className={cn(
                        "rounded px-2 py-1 text-[11px] font-medium transition-colors border",
                        viewerState.inverted ? "bg-white text-black border-white" : "border-white/20 text-gray-300 hover:bg-white/10"
                      )}
                    >
                      Invert
                    </button>
                  </Tooltip>

                  <Tooltip label="Toggle AI diagnostic overlay boxes">
                    <button
                      onClick={() => setAnnotatedView((v) => !v)}
                      className={cn(
                        "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors border",
                        annotatedView ? "bg-clinical/20 text-clinical border-clinical/50" : "border-white/20 text-gray-400 hover:text-gray-200"
                      )}
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>AI Overlay</span>
                    </button>
                  </Tooltip>

                  <Tooltip label="Reset zoom, pan and window/level">
                    <button
                      onClick={() => setViewerState(DEFAULT_VIEWER_STATE)}
                      className="rounded p-1 text-gray-400 hover:text-white transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Annotation Toolbar when any annotation tool is active */}
              {isAnnotationToolActive && (
                <div className="border-b border-white/10 bg-[#111722] px-3 py-1.5 z-10">
                  <AnnotationToolbar
                    activeTool={viewerState.tool}
                    onSelectTool={(tool) => setViewerState((s) => ({ ...s, tool }))}
                    findingType={activeFindingType}
                    setFindingType={(t) => setActiveFindingType(t as FindingType)}
                    customLabel={activeCustomLabel}
                    setCustomLabel={setActiveCustomLabel}
                    color={brushColor}
                    setColor={setBrushColor}
                    size={brushSize}
                    setSize={setBrushSize}
                    opacity={brushOpacity}
                    setOpacity={setBrushOpacity}
                    canUndo={undoStack.length > 0 || currentAnnotations.length > 0}
                    canRedo={redoStack.length > 0}
                    onUndo={() => {
                      if (undoStack.length > 0) {
                        handleUndoAnnotation();
                      } else {
                        setAnnotations((prev) => {
                          const last = prev[prev.length - 1];
                          return last ? prev.slice(0, -1) : prev;
                        });
                      }
                    }}
                    onRedo={handleRedoAnnotation}
                    onClear={() => {
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        return prev.filter(
                          (a) =>
                            !(a.seriesId === activeSeries.id && a.sliceIndex === currentSlice)
                        );
                      });
                    }}
                    onExit={() => {
                      setViewerState((s) => ({ ...s, tool: "window" }));
                      setAnnotationMode(null);
                    }}
                    strokeCount={currentAnnotations.length}
                  />
                </div>
              )}

              {/* Viewport Render: 1x1 ImageViewer OR 2x2 MultiPlaneGrid */}
              <div className="flex-1 relative min-h-0 bg-black">
                {layout !== "1x1" ? (
                  <MultiPlaneGrid
                    study={study}
                    layout={layout}
                    globalViewerState={viewerState}
                    findings={overlayFindings}
                    activeFindingId={selectedFindingId || hoveredFindingId}
                    onHoverFinding={setHoveredFindingId}
                    onSelectFinding={setSelectedFindingId}
                    markers={markers}
                    onAddMarker={(m) => setMarkers((prev) => [...prev, { ...m, createdAt: new Date().toISOString() }])}
                    measurements={measurements}
                    onAddMeasurement={(m) => setMeasurements((prev) => [...prev, m])}
                    annotations={annotations}
                    onCommitAnnotation={(ann) => {
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        setRedoStack([]);
                        return [...prev, { ...ann, studyId: study.studyId }];
                      });
                    }}
                    onDeleteAnnotation={(id) => {
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        return prev.filter((a) => a.id !== id);
                      });
                    }}
                    onQuickAnnotationNote={(id, note) => {
                      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
                    }}
                    onAddFinding={(id) => {}}
                    onEditFinding={(id) => {}}
                    annotations3D={annotations3D}
                    onAnnotations3DChange={setAnnotations3D}
                    getImageUrl={(s, idx) => {
                      if (s.images && s.images.length > 0) {
                        const m = s.images.find((img) => img.index === idx) ?? s.images[idx % s.images.length];
                        if (m?.imageUrl) return m.imageUrl;
                      }
                      return study.imageUrls?.[idx % (study.imageUrls.length || 1)];
                    }}
                    organMeshes={organMeshes}
                    onOrganMeshesChange={setOrganMeshes}
                  />
                ) : (
                  <ImageViewer
                    modality={study.modality}
                    seed={study.thumbnailSeed + currentSlice}
                    imageUrl={activeImageUrl}
                    isProcessing={study.status === "processing"}
                    findings={overlayFindings}
                    activeFindingId={selectedFindingId || hoveredFindingId}
                    onHoverFinding={setHoveredFindingId}
                    onSelectFinding={setSelectedFindingId}
                    viewerState={viewerState}
                    setViewerState={setViewerState}
                    markers={currentMarkers}
                    onAddMarker={(m) =>
                      setMarkers((prev) => [
                        ...prev,
                        {
                          ...m,
                          seriesId: activeSeries.id,
                          sliceIndex: currentSlice,
                          createdAt: new Date().toISOString(),
                        },
                      ])
                    }
                    onUpdateMarkerNote={(id, note) => {
                      setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, note } : m)));
                    }}
                    onDeleteMarker={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
                    measurements={currentMeasurements}
                    onAddMeasurement={(m) =>
                      setMeasurements((prev) => [
                        ...prev,
                        {
                          ...m,
                          seriesId: activeSeries.id,
                          sliceIndex: currentSlice,
                        },
                      ])
                    }
                    onClearAnnotations={() => {
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        return prev.filter(
                          (a) =>
                            !(a.seriesId === activeSeries.id && a.sliceIndex === currentSlice)
                        );
                      });
                    }}
                    hasImageData={hasImageData}
                    onImageReady={() => {}}
                    resetKey={`${activeSeries.id}:${currentSlice}`}
                    sliceLabel={
                      activeSeries.sliceCount > 1
                        ? `Slice ${currentSlice + 1} / ${activeSeries.sliceCount}`
                        : undefined
                    }
                    orientation={activeSeries.orientation}
                    seriesLabel={activeSeries.label}
                    patientAlias={study.patientAlias}
                    pixelSpacing={activeSeries.pixelSpacing}
                    studyId={study.id}
                    seriesId={activeSeries.id}
                    currentSlice={currentSlice}
                    emphasizedAnnotationId={emphasizedAnnotationId}
                    activeFindingType={activeFindingType}
                    activeCustomLabel={activeCustomLabel}
                    annotations={currentAnnotations}
                    brushColor={brushColor}
                    brushSizePx={BRUSH_WIDTH_PX[brushSize]}
                    brushOpacity={brushOpacity}
                    selectedAnnotationId={selectedAnnotationId}
                    onSelectAnnotation={setSelectedAnnotationId}
                    onCommitStroke={(points) => {
                      const stroke: ViewerAnnotation = {
                        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        studyId: study.id,
                        seriesId: activeSeries.id,
                        sliceIndex: currentSlice,
                        type: "freehand",
                        findingType: activeFindingType,
                        label: activeCustomLabel || activeFindingType,
                        points,
                        color: brushColor,
                        strokeWidth: BRUSH_WIDTH_PX[brushSize],
                        opacity: brushOpacity,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        visible: true,
                      };
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        setRedoStack([]);
                        return [...prev, stroke];
                      });
                      setSelectedAnnotationId(stroke.id);
                    }}
                    onCommitAnnotation={(ann) => {
                      const completeAnn: ViewerAnnotation = {
                        ...ann,
                        studyId: study.id,
                        seriesId: activeSeries.id,
                        sliceIndex: currentSlice,
                        findingType: activeFindingType,
                        label: activeCustomLabel || ann.text || activeFindingType,
                        visible: true,
                      };
                      setAnnotations((prev) => {
                        setUndoStack((u) => [...u, prev]);
                        setRedoStack([]);
                        return [...prev, completeAnn];
                      });
                      setSelectedAnnotationId(completeAnn.id);

                      // Promote ROI to finding so it appears in report & findings table
                      if (
                        (completeAnn.type === "rectangle" ||
                          completeAnn.type === "circle" ||
                          completeAnn.type === "polygon" ||
                          completeAnn.type === "freehand") &&
                        completeAnn.points.length >= 2
                      ) {
                        const xs = completeAnn.points.map((p) => p.x);
                        const ys = completeAnn.points.map((p) => p.y);
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minY = Math.min(...ys);
                        const maxY = Math.max(...ys);
                        const w = Math.max(0.01, maxX - minX);
                        const h = Math.max(0.01, maxY - minY);
                        const newFinding: Finding = {
                          id: `f-${completeAnn.id}`,
                          label: completeAnn.label || completeAnn.findingType || "Lesion ROI",
                          confidence: 100,
                          band: "high",
                          region: { x: minX, y: minY, w, h },
                          sliceIndex: currentSlice,
                          seriesId: activeSeries.id,
                          description: completeAnn.measureValue
                            ? `${completeAnn.findingType || "Finding"} · ${completeAnn.measureValue}`
                            : `Radiologist-annotated ${completeAnn.findingType || "finding"}`,
                          status: "accepted",
                          radiologistNote: completeAnn.radiologistNote,
                        };
                        study.findings = [newFinding, ...study.findings.filter((f) => f.id !== newFinding.id)];
                        completeAnn.findingId = newFinding.id;
                        setSelectedFindingId(newFinding.id);
                        pushToast({
                          title: `${completeAnn.findingType || "Lesion"} ROI Annotated`,
                          description: `Attached to Slice ${currentSlice + 1} and linked to 3D anatomical volume.`,
                          tone: "default",
                        });
                      } else if (completeAnn.type === "marker" && completeAnn.points.length >= 1) {
                        const p0 = completeAnn.points[0];
                        const newFinding: Finding = {
                          id: `f-${completeAnn.id}`,
                          label: completeAnn.label || "Anatomical Marker",
                          confidence: 100,
                          band: "high",
                          region: { x: Math.max(0, p0.x - 0.02), y: Math.max(0, p0.y - 0.02), w: 0.04, h: 0.04 },
                          sliceIndex: currentSlice,
                          seriesId: activeSeries.id,
                          description: "Radiologist marked anatomical focal point",
                          status: "accepted",
                          radiologistNote: completeAnn.radiologistNote,
                        };
                        study.findings = [newFinding, ...study.findings.filter((f) => f.id !== newFinding.id)];
                        completeAnn.findingId = newFinding.id;
                        setSelectedFindingId(newFinding.id);
                      }
                    }}
                    onDeleteAnnotation={(id) => {
                      setAnnotations((prev) => prev.filter((a) => a.id !== id));
                      study.findings = study.findings.filter((f) => f.id !== `f-${id}`);
                      if (selectedAnnotationId === id) setSelectedAnnotationId(null);
                    }}
                    onQuickAnnotationNote={(id, note) => {
                      setAnnotations((prev) =>
                        prev.map((a) => (a.id === id ? { ...a, radiologistNote: note, updatedAt: new Date().toISOString() } : a))
                      );
                      const f = study.findings.find((item) => item.id === `f-${id}`);
                      if (f) f.radiologistNote = note;
                    }}
                    onAddFinding={(annId) => {
                      const ann = annotations.find((a) => a.id === annId);
                      if (!ann) return;
                      const c = ann.points[0] || { x: 0.5, y: 0.5 };
                      const newFinding: Finding = {
                        id: `f-${ann.id}`,
                        label: ann.text || `${ann.type.toUpperCase()} Finding`,
                        confidence: 100,
                        band: "high",
                        region: { x: Math.max(0, c.x - 0.03), y: Math.max(0, c.y - 0.03), w: 0.06, h: 0.06 },
                        sliceIndex: currentSlice,
                        seriesId: activeSeries.id,
                        description: ann.measureValue ? `Measurement: ${ann.measureValue}` : "Clinical observation",
                        status: "accepted",
                        radiologistNote: ann.radiologistNote,
                      };
                      study.findings = [newFinding, ...study.findings.filter((f) => f.id !== newFinding.id)];
                      ann.findingId = newFinding.id;
                      setSelectedFindingId(newFinding.id);
                      setRightSubTab("findings");
                      pushToast({
                        title: "Finding Added",
                        description: "Observation registered and linked to 3D anatomy.",
                        tone: "default",
                      });
                    }}
                    onViewIn3D={(annId) => {
                      const ann = annotations.find((a) => a.id === annId);
                      if (ann?.findingId) setSelectedFindingId(ann.findingId);
                      setActiveMode("3d");
                    }}
                  />
                )}

                {/* Patient / Technical HUD Watermark Overlays */}
                <div className="pointer-events-none absolute top-3 left-3 text-[11px] font-mono text-white/70 leading-tight">
                  <div className="font-semibold text-white">{study.patientAlias}</div>
                  <div>ID: {study.studyId}</div>
                  <div>
                    {[study.age ? `${study.age}y` : "", study.sex].filter(Boolean).join(" · ")}
                  </div>
                </div>

                <div className="pointer-events-none absolute top-3 right-3 text-right text-[11px] font-mono text-white/70 leading-tight">
                  <div className="font-semibold text-white">{study.modality} {study.bodyRegion}</div>
                  <div>{activeSeries.label}</div>
                  <div>
                    {study.date ? new Date(study.date).toLocaleDateString() : ""}
                  </div>
                </div>

                <div className="pointer-events-none absolute bottom-14 left-3 text-[11px] font-mono text-white/60 leading-tight">
                  <div>
                    W: {Math.round(viewerState.windowWidth)} L: {Math.round(viewerState.windowCenter)}
                  </div>
                  <div>Zoom: {viewerState.zoom.toFixed(1)}x</div>
                </div>

                <div className="pointer-events-none absolute bottom-14 right-3 text-right text-[11px] font-mono text-white/60 leading-tight">
                  <div>{activeSeries.orientation || "Transverse"}</div>
                  {activeSeries.sliceCount > 1 && (
                    <div className="text-clinical font-semibold">
                      Slice {currentSlice + 1} / {activeSeries.sliceCount}
                    </div>
                  )}
                  {activeSeries.pixelSpacing && (
                    <div>Pixel Spacing: {activeSeries.pixelSpacing[0].toFixed(2)}mm</div>
                  )}
                </div>

                {/* Floating PET Fusion Controls if Modality is PET */}
                {study.modality === "PET" && (
                  <div className="absolute top-12 right-4 z-20 w-80 max-w-full">
                    <ClinicalPetControls
                      petOpacity={petOpacity}
                      onPetOpacityChange={setPetOpacity}
                      suvMax={petSuvMax}
                      onSuvMaxChange={setPetSuvMax}
                      suvMin={petSuvMin}
                      onSuvMinChange={setPetSuvMin}
                      petVisible={petVisible}
                      onTogglePetVisible={setPetVisible}
                      colormap={petColormap}
                      onColormapChange={setPetColormap}
                      onReset={() => {
                        setPetOpacity(0.65);
                        setPetSuvMax(15);
                        setPetSuvMin(0);
                        setPetVisible(true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Bottom Slice Navigation / Cine Controls */}
              {activeSeries.sliceCount > 1 && (
                <div className="shrink-0 border-t border-white/10 bg-[#0d121c] px-4 py-2 z-10">
                  <SliceNavigator
                    current={currentSlice}
                    total={activeSeries.sliceCount}
                    onChange={setCurrentSlice}
                    orientation={activeSeries.orientation}
                    playing={playing}
                    onTogglePlay={() => setPlaying((p) => !p)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Active Mode: 3D Anatomy */}
          {activeMode === "3d" && (
            <div className="flex-1 flex flex-col min-h-0 relative bg-[#080c14]">
              {/* 3D Viewport Controls Subheader */}
              <div className="flex items-center justify-between border-b border-white/10 bg-[#0d121c] px-4 py-2 text-[12px] text-gray-300 z-10">
                <div className="flex items-center gap-2">
                  <Box className="h-4 w-4 text-clinical" />
                  <span className="font-semibold text-white">Patient-Specific 3D Anatomy</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-300 font-mono text-[11px]">{activeSeries.label}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded border border-white/15 bg-black/40 p-0.5 text-[11px]">
                    <button
                      onClick={() => setView3DStyle("mesh")}
                      className={cn(
                        "rounded px-2.5 py-1 font-medium transition-colors",
                        view3DStyle === "mesh" ? "bg-clinical text-white" : "text-gray-400 hover:text-white"
                      )}
                    >
                      Organ Meshes
                    </button>
                    <button
                      onClick={() => setView3DStyle("raymarch")}
                      className={cn(
                        "rounded px-2.5 py-1 font-medium transition-colors",
                        view3DStyle === "raymarch" ? "bg-clinical text-white" : "text-gray-400 hover:text-white"
                      )}
                    >
                      Volume Ray-March
                    </button>
                  </div>
                </div>
              </div>

              {/* 3D Canvas */}
              <div className="flex-1 relative min-h-0">
                <ViewerErrorBoundary fallbackTitle="3D Reconstruction Unavailable">
                  <Patient3DAnatomyViewer
                    studyId={study.id}
                    seriesId={activeSeries.id}
                    modality={study.modality}
                    bodyRegion={study.bodyRegion}
                    volumeUrl={imageUrlAt(0)}
                    sliceCount={activeSeries.sliceCount}
                    sliceUrlAt={imageUrlAt}
                    showLayerPanel={false}
                    initialAnnotations={annotations3D}
                    onAnnotationsChange={setAnnotations3D}
                    findings={study.findings}
                    annotations={annotations}
                    activeFindingId={selectedFindingId}
                    onSelectFinding={setSelectedFindingId}
                    onSelectFindingMarker={handleSelect3DMarker}
                    crosshairPos={{ x: 0.5, y: 0.5, z: currentSlice / Math.max(1, activeSeries.sliceCount - 1) }}
                    onPointSelected={(pt) => {
                      const target = Math.round(pt.z * (activeSeries.sliceCount - 1));
                      setCurrentSlice(Math.max(0, Math.min(activeSeries.sliceCount - 1, target)));
                    }}
                    organMeshes={organMeshes}
                    onOrganMeshesChange={setOrganMeshes}
                    onSelectOrgan={setActiveOrganId}
                    activeOrganId={activeOrganId}
                  />
                </ViewerErrorBoundary>

                {/* 3D Interaction Hints */}
                <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/60 px-3 py-1.5 text-[11px] text-gray-300 backdrop-blur-sm">
                  <span>Left-drag: Rotate</span>
                  <span className="mx-2 text-white/30">|</span>
                  <span>Right-drag: Pan</span>
                  <span className="mx-2 text-white/30">|</span>
                  <span>Scroll: Zoom</span>
                </div>
              </div>
            </div>
          )}

          {/* Active Mode: 4D Cine (Genuine multi-phase cine or clear unavailable message) */}
          {activeMode === "4d" && (
            <div className="flex-1 flex flex-col min-h-0 relative bg-[#080c14]">
              <ViewerErrorBoundary fallbackTitle="4D Cine Reconstruction Unavailable">
                <Patient4DCineViewer
                  study={study}
                  activePhase={cinePhase}
                  onPhaseChange={setCinePhase}
                  className="h-full w-full"
                  height="100%"
                />
              </ViewerErrorBoundary>
            </div>
          )}

          {/* Active Mode: AI / Analysis */}
          {activeMode === "ai" && (
            <div className="flex-1 flex flex-col min-h-0 relative bg-[#080c14]">
              {/* Split layout: Clinical 3D Preview on left, Analysis Task Manager on right */}
              <div className="flex-1 flex min-h-0">
                <div className="flex-1 h-full relative">
                  <ViewerErrorBoundary fallbackTitle="AI 3D View Unavailable">
                    <Patient3DAnatomyViewer
                      studyId={study.id}
                      seriesId={activeSeries.id}
                      modality={study.modality}
                      bodyRegion={study.bodyRegion}
                      volumeUrl={imageUrlAt(0)}
                      sliceCount={activeSeries.sliceCount}
                      sliceUrlAt={imageUrlAt}
                      showLayerPanel={false}
                      findings={study.findings}
                      annotations={annotations}
                      activeFindingId={selectedFindingId}
                      onSelectFinding={setSelectedFindingId}
                      onSelectFindingMarker={handleSelect3DMarker}
                      crosshairPos={{ x: 0.5, y: 0.5, z: currentSlice / Math.max(1, activeSeries.sliceCount - 1) }}
                      onPointSelected={(pt) => {
                        const target = Math.round(pt.z * (activeSeries.sliceCount - 1));
                        setCurrentSlice(Math.max(0, Math.min(activeSeries.sliceCount - 1, target)));
                      }}
                      organMeshes={organMeshes}
                      onOrganMeshesChange={setOrganMeshes}
                      onSelectOrgan={setActiveOrganId}
                      activeOrganId={activeOrganId}
                      className="h-full w-full"
                      height="100%"
                    />
                  </ViewerErrorBoundary>
                </div>

                <div className="w-[380px] shrink-0 border-l border-border bg-panel overflow-y-auto">
                  <ClinicalAIPanel
                    study={study}
                    activeSeries={activeSeries}
                    organMeshes={organMeshes}
                    onOrganMeshesChange={setOrganMeshes}
                    onJumpToSlice={(idx) => {
                      setCurrentSlice(idx);
                      setActiveMode("images");
                    }}
                    onAppendFindingToReport={onAppendFindingToReport}
                    onOpenReportTab={() => setActiveMode("report")}
                    onSwitchTo3D={() => setActiveMode("3d")}
                    findings={study.findings}
                    onUpdateFinding={onUpdateFinding}
                    activeFindingId={selectedFindingId}
                    onSelectFinding={setSelectedFindingId}
                    onSelectSeries={(sId) => {
                      setActiveSeriesId(sId);
                      setActiveMode("images");
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Active Mode: Report */}
          {activeMode === "report" && (
            <div className="flex-1 flex flex-col min-h-0 bg-base overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-[1360px] grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
                {/* Main Report Editor */}
                <div className="flex flex-col gap-6">
                  {/* Working Report Editor */}
                  <div className="rounded-xl border border-border bg-panel p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-[17px] font-semibold text-ink-primary">
                            Diagnostic Working Report
                          </h2>
                          <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-sky-400 border border-sky-500/20">
                            <Pencil className="h-2.5 w-2.5" /> Editable Clinical Draft
                          </span>
                        </div>
                        <p className="text-[12px] text-ink-secondary mt-0.5">
                          Radiologist working draft for study {study.studyId} · {study.patientAlias}
                        </p>
                      </div>
                      <ExportButton study={study} />
                    </div>

                    <ReportEditor
                      report={study.report}
                      study={study}
                      onChange={onChangeSections}
                    />
                  </div>

                  {/* Original Immutable Source Report from PACS */}
                  <div className="rounded-xl border border-border bg-panel shadow-sm overflow-hidden">
                    <RadiologyReportPanel sourceReport={study.sourceReport} />
                  </div>
                </div>

                {/* Right Column: Approval & Sign-Off */}
                <div className="flex flex-col gap-5">
                  <ApprovalPanel
                    report={study.report}
                    study={study}
                    onApprove={onApprove}
                  />

                  {/* AI Suggested Findings Review */}
                  <div className="rounded-xl border border-border bg-panel shadow-sm p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[13px] font-semibold text-ink-primary flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-clinical" />
                        AI Findings Verification
                      </h3>
                      <span className="text-[11px] font-mono text-ink-muted">
                        {study.findings.length} Detected
                      </span>
                    </div>
                    {study.findings.length === 0 ? (
                      <p className="text-[12px] text-ink-muted py-2 text-center">
                        No automated AI findings on this study.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {study.findings.map((f) => (
                          <div
                            key={f.id}
                            className="rounded-lg border border-border bg-panel-alt p-3 text-[12px] space-y-2"
                          >
                            <div className="flex items-center justify-between font-medium text-ink-primary">
                              <span className="font-semibold">{f.label}</span>
                              <span className="font-mono text-ink-secondary text-[11px]">{f.confidence}%</span>
                            </div>
                            {f.description && (
                              <p className="text-[11.5px] text-ink-secondary leading-snug">
                                {f.description}
                              </p>
                            )}
                            <div className="flex items-center justify-between pt-1 border-t border-border/60">
                              <span className="text-[10.5px] text-ink-muted font-mono">
                                {f.sliceIndex !== undefined ? `Slice ${f.sliceIndex + 1}` : "Volumetric"}
                              </span>
                              {f.status === "accepted" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                  <Check className="h-3 w-3" /> Added to Report
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onAppendFindingToReport(
                                      `${f.label}${f.sliceIndex !== undefined ? ` (Slice ${f.sliceIndex + 1})` : ""}: ${f.description || "Identified on AI analysis"}`
                                    );
                                    onUpdateFinding(f.id, { status: "accepted" });
                                  }}
                                  className="inline-flex items-center gap-1 rounded bg-clinical/15 border border-clinical/30 px-2 py-0.5 text-[11px] font-medium text-clinical hover:bg-clinical/25 transition-colors"
                                >
                                  <span>Accept &amp; Add</span>
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* 3. RIGHT CONTEXT PANEL: Contextual based on active workflow mode */}
        {!isFullscreen && activeMode !== "report" && activeMode !== "ai" && (
          rightPanelCollapsed ? (
            <div className="w-9 shrink-0 h-full border-l border-border bg-panel flex flex-col items-center py-3 select-none">
              <button
                onClick={() => setRightPanelCollapsed(false)}
                className="rounded p-1.5 text-ink-muted hover:text-ink-primary hover:bg-base transition-colors"
                title="Expand Clinical Inspector"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="mt-6 [writing-mode:vertical-rl] rotate-180 font-mono text-[10.5px] text-ink-secondary uppercase tracking-widest flex items-center gap-1.5">
                <span>Inspector ({study.findings.length})</span>
              </div>
            </div>
          ) : (
            <aside className="w-[320px] shrink-0 h-full border-l border-border bg-panel overflow-hidden flex flex-col relative">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-panel-alt">
                <span className="text-[11px] font-semibold text-ink-primary tracking-tight">Clinical Inspector</span>
                <button
                  onClick={() => setRightPanelCollapsed(true)}
                  className="rounded p-1 text-ink-muted hover:text-ink-primary hover:bg-base transition-colors"
                  title="Collapse Inspector"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            {/* Mode: 2D / MPR */}
            {activeMode === "images" && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Subtabs: Tools & W/L | Findings | Annotations */}
                <div className="flex border-b border-border bg-base text-[12px] shrink-0">
                  <button
                    onClick={() => setRightSubTab("tools")}
                    className={cn(
                      "flex-1 py-2.5 text-center font-medium border-b-2 transition-colors",
                      rightSubTab === "tools"
                        ? "border-clinical text-clinical"
                        : "border-transparent text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    Tools &amp; W/L
                  </button>
                  <button
                    onClick={() => setRightSubTab("findings")}
                    className={cn(
                      "flex-1 py-2.5 text-center font-medium border-b-2 transition-colors",
                      rightSubTab === "findings"
                        ? "border-clinical text-clinical"
                        : "border-transparent text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    Findings ({study.findings.length})
                  </button>
                  <button
                    onClick={() => setRightSubTab("annotations")}
                    className={cn(
                      "flex-1 py-2.5 text-center font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
                      rightSubTab === "annotations"
                        ? "border-clinical text-clinical"
                        : "border-transparent text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    <span>Annotations ({annotations.length})</span>
                  </button>
                </div>

                {rightSubTab === "annotations" ? (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <AnnotationPanel
                      studyId={study.id}
                      annotations={annotations}
                      annotations3D={annotations3D}
                      series={study.series}
                      activeSeriesId={activeSeries.id}
                      currentSlice={currentSlice}
                      selectedId={selectedAnnotationId}
                      onSelectAnnotation={(id) => {
                        setSelectedAnnotationId(id);
                        if (id) {
                          const ann = annotations.find((a) => a.id === id);
                          if (ann) handleJumpTo2D(ann);
                        }
                      }}
                      onDeleteAnnotation={(id) => {
                        setAnnotations((prev) => {
                          setUndoStack((u) => [...u, prev]);
                          return prev.filter((a) => a.id !== id);
                        });
                        study.findings = study.findings.filter((f) => f.id !== `f-${id}`);
                        if (selectedAnnotationId === id) setSelectedAnnotationId(null);
                      }}
                      onToggleVisibility={(id) => {
                        setAnnotations((prev) =>
                          prev.map((a) => (a.id === id ? { ...a, visible: a.visible === false ? true : false } : a))
                        );
                      }}
                      onJumpTo2D={handleJumpTo2D}
                      onJumpTo3D={(ann) => {
                        setActiveMode("3d");
                        setRight3DSubTab("annotations");
                        const targetId = "findingId" in ann && ann.findingId ? ann.findingId : ann.id;
                        setSelectedFindingId(targetId);
                      }}
                      onStartNewAnnotation={() => {
                        setActiveMode("images");
                        setViewerState((s) => ({ ...s, tool: "rect" }));
                        setAnnotationMode("2d");
                      }}
                      activeMode={activeMode}
                      onSelectMode={(mode) => setActiveMode(mode)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[12px]">
                    {rightSubTab === "tools" && (
                      <>
                        {/* Window / Level Controls */}
                        <div className="rounded-lg border border-border bg-panel-alt p-3.5 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink-primary">Window / Level</span>
                            <span className="font-mono text-[11px] text-ink-secondary">
                              W: {Math.round(viewerState.windowWidth)} · L: {Math.round(viewerState.windowCenter)}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-ink-secondary">
                              <span>Window Width</span>
                              <span>{Math.round(viewerState.windowWidth)}</span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="2500"
                              value={viewerState.windowWidth}
                              onChange={(e) =>
                                setViewerState((s) => ({ ...s, windowWidth: Number(e.target.value) }))
                              }
                              className="w-full accent-clinical"
                            />

                            <div className="flex items-center justify-between text-[11px] text-ink-secondary pt-1">
                              <span>Window Level (Center)</span>
                              <span>{Math.round(viewerState.windowCenter)}</span>
                            </div>
                            <input
                              type="range"
                              min="-1000"
                              max="1000"
                              value={viewerState.windowCenter}
                              onChange={(e) =>
                                setViewerState((s) => ({ ...s, windowCenter: Number(e.target.value) }))
                              }
                              className="w-full accent-clinical"
                            />
                          </div>

                          {/* Quick Preset Buttons */}
                          <div className="grid grid-cols-2 gap-1.5 pt-2">
                            {WINDOW_PRESETS.map((p) => (
                              <button
                                key={p.id}
                                onClick={() =>
                                  setViewerState((s) => ({
                                    ...s,
                                    windowWidth: p.window,
                                    windowCenter: p.level,
                                  }))
                                }
                                className="rounded border border-border bg-base px-2 py-1 text-[11px] font-medium text-ink-primary hover:border-clinical/50 transition-colors"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Active Slice Information */}
                        <div className="rounded-lg border border-border bg-panel-alt p-3.5 space-y-2">
                          <span className="font-semibold text-ink-primary block">Active Acquisition</span>
                          <div className="space-y-1 font-mono text-[11.5px] text-ink-secondary">
                            <div className="flex justify-between">
                              <span>Series:</span>
                              <span className="text-ink-primary">{activeSeries.label}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Slice:</span>
                              <span className="text-ink-primary">
                                {currentSlice + 1} / {activeSeries.sliceCount}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Orientation:</span>
                              <span className="text-ink-primary">{activeSeries.orientation}</span>
                            </div>
                            {activeSeries.pixelSpacing && (
                              <div className="flex justify-between">
                                <span>Pixel Spacing:</span>
                                <span className="text-ink-primary">
                                  {activeSeries.pixelSpacing[0].toFixed(2)} × {activeSeries.pixelSpacing[1].toFixed(2)} mm
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quick Jump to 3D / AI */}
                        <div className="rounded-lg border border-clinical/30 bg-clinical/5 p-3.5 space-y-2">
                          <span className="font-semibold text-clinical block">Advanced Analysis</span>
                          <p className="text-[11.5px] text-ink-secondary">
                            Review volumetric 3D organ structures or initiate automated MONAI segmentation.
                          </p>
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => setActiveMode("3d")}
                              className="flex-1 text-[11.5px]"
                            >
                              <Box className="h-3.5 w-3.5 mr-1" /> Open 3D
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setActiveMode("ai")}
                              className="flex-1 text-[11.5px]"
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1" /> AI Tools
                            </Button>
                          </div>
                        </div>
                      </>
                    )}

                    {rightSubTab === "findings" && (
                      <FindingsPanel
                        findings={study.findings}
                        activeFindingId={selectedFindingId}
                        onHover={setHoveredFindingId}
                        onSelect={(id: string) => {
                          setSelectedFindingId(id);
                          const f = study.findings.find((item) => item.id === id);
                          if (f && f.sliceIndex !== undefined) {
                            setCurrentSlice(f.sliceIndex);
                          }
                        }}
                        onUpdate={onUpdateFinding}
                        isProcessing={study.status === "processing"}
                        series={study.series}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mode: 3D Anatomy -> Organ Panel OR 3D Annotation Panel */}
            {activeMode === "3d" && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex border-b border-border bg-base text-[12px] shrink-0">
                  <button
                    onClick={() => setRight3DSubTab("anatomy")}
                    className={cn(
                      "flex-1 py-2.5 text-center font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
                      right3DSubTab === "anatomy"
                        ? "border-clinical text-clinical"
                        : "border-transparent text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Anatomy Layers</span>
                  </button>
                  <button
                    onClick={() => setRight3DSubTab("annotations")}
                    className={cn(
                      "flex-1 py-2.5 text-center font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
                      right3DSubTab === "annotations"
                        ? "border-clinical text-clinical"
                        : "border-transparent text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    <Box className="h-3.5 w-3.5" />
                    <span>3D Annotations ({annotations.length})</span>
                  </button>
                </div>

                {right3DSubTab === "anatomy" ? (
                  <ClinicalOrganPanel
                    organMeshes={organMeshes}
                    onOrganMeshesChange={setOrganMeshes}
                    onSelectOrgan={setActiveOrganId}
                    activeOrganId={activeOrganId}
                    showOriginalVolume={showOriginalVolume}
                    onToggleOriginalVolume={setShowOriginalVolume}
                    threshold={threshold3D}
                    onThresholdChange={setThreshold3D}
                    density={density3D}
                    onDensityChange={setDensity3D}
                    colormap={colormap3D}
                    onColormapChange={setColormap3D}
                    enableClipping={enableClipping}
                    onToggleClipping={setEnableClipping}
                    clipDistance={clipDistance}
                    onClipDistanceChange={setClipDistance}
                    clipAxis={clipAxis}
                    onClipAxisChange={setClipAxis}
                    onReset3DView={() => {
                      setThreshold3D(0.2);
                      setDensity3D(1.2);
                      setEnableClipping(false);
                      setClipDistance(0.5);
                    }}
                  />
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <AnnotationPanel
                      studyId={study.id}
                      annotations={annotations}
                      annotations3D={annotations3D}
                      series={study.series}
                      activeSeriesId={activeSeries.id}
                      currentSlice={currentSlice}
                      selectedId={selectedAnnotationId}
                      onSelectAnnotation={(id) => {
                        setSelectedAnnotationId(id);
                        if (id) {
                          const ann = annotations.find((a) => a.id === id);
                          if (ann) handleJumpTo2D(ann);
                        }
                      }}
                      onDeleteAnnotation={(id) => {
                        setAnnotations((prev) => {
                          setUndoStack((u) => [...u, prev]);
                          return prev.filter((a) => a.id !== id);
                        });
                        study.findings = study.findings.filter((f) => f.id !== `f-${id}`);
                        if (selectedAnnotationId === id) setSelectedAnnotationId(null);
                      }}
                      onToggleVisibility={(id) => {
                        setAnnotations((prev) =>
                          prev.map((a) => (a.id === id ? { ...a, visible: a.visible === false ? true : false } : a))
                        );
                      }}
                      onJumpTo2D={handleJumpTo2D}
                      onJumpTo3D={(ann) => {
                        setActiveMode("3d");
                        const targetId = "findingId" in ann && ann.findingId ? ann.findingId : ann.id;
                        setSelectedFindingId(targetId);
                      }}
                      onStartNewAnnotation={() => {
                        setActiveMode("images");
                        setViewerState((s) => ({ ...s, tool: "rect" }));
                        setAnnotationMode("2d");
                      }}
                      activeMode={activeMode}
                      onSelectMode={(mode) => setActiveMode(mode)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Mode: 4D Cine -> 4D Dynamics Panel */}
            {activeMode === "4d" && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[12px]">
                <Clinical4DControls
                  activePhase={cinePhase}
                  totalPhases={8}
                  isPlaying={cine4DPlaying}
                  onTogglePlay={() => setCine4DPlaying((p) => !p)}
                  onPhaseChange={setCinePhase}
                  fps={fps4D}
                  onFpsChange={setFps4D}
                  cardiacMetrics={cardiacMetrics}
                />
              </div>
            )}
          </aside>
          )
        )}
      </div>

      {/* Patient Info Modal */}
      {patientInfoOpen && (
        <Modal
          title="Verified Patient Demographics"
          open={patientInfoOpen}
          onClose={() => setPatientInfoOpen(false)}
        >
          <div className="space-y-3 text-[13px] text-ink-primary">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-panel-alt p-3.5">
              <div>
                <span className="text-[11px] text-ink-muted uppercase block">Full Name</span>
                <span className="font-semibold text-[14px]">{study.patientAlias}</span>
              </div>
              <div>
                <span className="text-[11px] text-ink-muted uppercase block">Patient MRN / ID</span>
                <span className="font-mono">{study.studyId}</span>
              </div>
              <div>
                <span className="text-[11px] text-ink-muted uppercase block">Age / Sex</span>
                <span>{study.age !== undefined ? `${study.age} years` : "N/A"} · {study.sex || "Unknown"}</span>
              </div>
              <div>
                <span className="text-[11px] text-ink-muted uppercase block">Modality / Body Region</span>
                <span>{study.modality} · {study.bodyRegion}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setPatientInfoOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Study Acquisition Info Modal */}
      {studyInfoOpen && (
        <Modal
          title="DICOM Acquisition Details"
          open={studyInfoOpen}
          onClose={() => setStudyInfoOpen(false)}
        >
          <div className="space-y-3 text-[13px] text-ink-primary">
            <div className="rounded-lg border border-border bg-panel-alt p-3.5 space-y-2 font-mono text-[12px]">
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-ink-secondary">Study Instance UID:</span>
                <span className="text-ink-primary">{study.studyId}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-ink-secondary">Study Date:</span>
                <span className="text-ink-primary">{study.date || "N/A"}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-ink-secondary">Total Series Count:</span>
                <span className="text-ink-primary">{study.series.length}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-ink-secondary">Primary Modality:</span>
                <span className="text-ink-primary">{study.modality}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-secondary">Dataset Source:</span>
                <span className="text-ink-primary">{study.datasetSource || "PACS Archive"}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setStudyInfoOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Keyboard Shortcuts Reference Modal (Section 31) */}
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
