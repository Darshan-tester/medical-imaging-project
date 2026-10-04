"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Layers, Sparkles, MapPin, FileText, Pencil, Box, Boxes, Square, Image as ImageIcon, GitCompare, type LucideIcon } from "lucide-react";
import { Study, Finding, Marker, ViewerMeasurement, ViewerAnnotation, RadiologistFinding, ViewerImage, ViewportLayout, Annotation3D, SeriesInfo } from "@/lib/types";
import { CURRENT_USER } from "@/lib/mock-data";
import { resolveReportPanelContent } from "@/lib/report-utils";
import { SeriesNavigator } from "@/components/viewer/SeriesNavigator";
import { ImageViewer } from "@/components/viewer/ImageViewer";
import { ViewerToolbar, DEFAULT_VIEWER_STATE, ViewerState } from "@/components/viewer/ViewerToolbar";
import { AnnotationToolbar, AnnotationBrushSize, BRUSH_WIDTH_PX, DEFAULT_ANNOTATION_COLOR } from "@/components/viewer/AnnotationToolbar";
import { AnnotationEditor, FindingDraft } from "@/components/viewer/AnnotationEditor";
import { SliceNavigator } from "@/components/viewer/SliceNavigator";
import { ThumbnailStrip } from "@/components/viewer/ThumbnailStrip";
import { FindingsPanel } from "@/components/viewer/FindingsPanel";
import { MarkersPanel } from "@/components/viewer/MarkersPanel";
import { MultiPlaneGrid } from "@/components/viewer/MultiPlaneGrid";
import { PriorComparisonPanel } from "@/components/viewer/PriorComparisonPanel";
import { RadiologyReportPanel } from "@/components/report/RadiologyReportPanel";
import { CriticalFindingBanner } from "@/components/viewer/CriticalFindingBanner";
import { ViewerErrorBoundary } from "@/components/viewer/ViewerErrorBoundary";
import { AIAnalysisPanel, OrganMeshState } from "@/components/viewer/AIAnalysisPanel";
import { SessionAnnotationStore } from "@/lib/annotation-store";
import { AuditTrail } from "@/lib/audit-trail";
import { useAuthStore } from "@/lib/store";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ctPerfCurrentSlice, ctPerfNewStudy, ctPerfSliceIndex } from "@/lib/viewer/perf";
import { peekSlice } from "@/lib/viewer/slice-cache";
import { isDecodableUrl } from "@/lib/viewer/slice-source";
import { useSlicePrefetch } from "@/lib/viewer/use-slice-prefetch";
import { cn } from "@/lib/utils";

type RightPanelTab = "ai" | "ai3d" | "comparison" | "report" | "annotations";
const RIGHT_PANEL_TABS: { key: RightPanelTab; label: string; icon: LucideIcon }[] = [
  { key: "ai", label: "AI Findings", icon: Sparkles },
  { key: "ai3d", label: "3D AI (MONAI)", icon: Boxes },
  { key: "comparison", label: "Comparison", icon: GitCompare },
  { key: "report", label: "Radiology Report", icon: FileText },
  { key: "annotations", label: "Annotations", icon: Pencil },
];

function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * three.js + the ray-marching viewer are ~150 kB that only CT (and any other
 * reconstructed stack) can use, so they are only fetched once the radiologist
 * actually switches a volumetric series into 3-D.
 */
const Volume3DViewer = dynamic(() => import("@/components/viewer/Volume3DViewer").then((m) => m.Volume3DViewer), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-viewer" />,
});

// Keys that should never hijack normal typing (note inputs, future text fields, etc.)
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function AnalysisTab({
  study,
  allStudies,
  onUpdateFinding,
  onAppendFindingToReport,
  onOpenReportTab,
}: {
  study: Study;
  allStudies?: Study[];
  onUpdateFinding: (id: string, patch: Partial<Finding>) => void;
  /** Appends a radiologist-authored finding into the report's Findings section — never overwrites existing report content. */
  onAppendFindingToReport: (text: string) => void;
  /** Jumps to the full Report & Approval tab — used by the Radiology Report panel's "Open full Report" button. */
  onOpenReportTab?: () => void;
}) {
  const [activeSeriesId, setActiveSeriesId] = useState(study.series[0]?.id ?? "");
  const [currentSlice, setCurrentSlice] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>(DEFAULT_VIEWER_STATE);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPanelTab>("ai");
  const [mobileSeriesOpen, setMobileSeriesOpen] = useState(false);
  const [mobileFindingsOpen, setMobileFindingsOpen] = useState(false);
  const [mobileMarkersOpen, setMobileMarkersOpen] = useState(false);
  const [mobileReportOpen, setMobileReportOpen] = useState(false);
  /** Full-screen MONAI Physio AI Workstation — hides the 3-col layout */
  const [monaiOpen, setMonaiOpen] = useState(false);

  /*
   * 2-D planes vs. the interactive volume render. Only offered for a series the
   * indexer actually reconstructed into a stack (`SeriesInfo.volumeAvailable`);
   * there is deliberately no 3-D mode that fakes a volume out of one X-ray.
   */
  const [view3D, setView3D] = useState(false);
  const [layout, setLayout] = useState<ViewportLayout>("1x1");
  const [annotations3D, setAnnotations3D] = useState<Annotation3D[]>([]);
  const [organMeshes, setOrganMeshes] = useState<OrganMeshState[]>([]);

  /*
   * Original vs. Annotated. The AI overlay used to be drawn unconditionally,
   * which left no way to see the unobstructed image — and the boxes sit exactly
   * over the thing the reader wants to look at. Defaults to Annotated so the
   * previous behaviour is unchanged for anyone who doesn't touch the switch.
   *
   * Note this hides only the *AI* overlay. Radiologist-drawn strokes, markers
   * and measurements are the user's own work and are never hidden by it.
   */
  const [annotatedView, setAnnotatedView] = useState(true);


  // Markers and measurements live for the whole study session (not persisted to
  // a backend — nothing else in this demo app persists edits either — but
  // scoped in memory to their exact series + slice so they never leak across
  // images when the user navigates).
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [measurements, setMeasurements] = useState<ViewerMeasurement[]>([]);

  // ---- Radiologist pen/pencil annotations + findings ----------------------
  // Same in-memory, session-scoped persistence model as markers/measurements
  // above (this demo app has no backend yet); always tagged with the exact
  // study + series + slice they belong to and filtered down before reaching
  // ImageViewer, so a stroke never leaks onto another slice.
  const [annotations, setAnnotations] = useState<ViewerAnnotation[]>([]);
  const [radiologistFindings, setRadiologistFindings] = useState<RadiologistFinding[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const { user } = useAuthStore();
  const [acknowledgedCriticalIds, setAcknowledgedCriticalIds] = useState<string[]>([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"saved" | "saving">("saved");

  // Hydrate annotations, measurements, markers, and acknowledged critical findings from SessionAnnotationStore (BUG-02)
  useEffect(() => {
    const saved = SessionAnnotationStore.load(study.id);
    if (saved) {
      if (saved.markers?.length) setMarkers(saved.markers);
      if (saved.measurements?.length) setMeasurements(saved.measurements);
      if (saved.annotations?.length) setAnnotations(saved.annotations);
      if (saved.acknowledgedCriticalFindings?.length) {
        setAcknowledgedCriticalIds(saved.acknowledgedCriticalFindings);
      }
    }
    AuditTrail.record(study.id, "STUDY_OPENED", user, {
      patientAlias: study.patientAlias,
      modality: study.modality,
    });
  }, [study.id, user]);

  // Debounced auto-save to SessionAnnotationStore
  useEffect(() => {
    setAutoSaveStatus("saving");
    const timer = setTimeout(() => {
      SessionAnnotationStore.save({
        studyId: study.id,
        updatedAt: new Date().toISOString(),
        annotations,
        measurements,
        markers,
        findings: study.findings,
        acknowledgedCriticalFindings: acknowledgedCriticalIds,
      });
      setAutoSaveStatus("saved");
    }, 500);
    return () => clearTimeout(timer);
  }, [study.id, annotations, measurements, markers, acknowledgedCriticalIds, study.findings]);

  // Undo/redo history, scoped per "seriesId:sliceIndex" — undo only ever
  // pops the most recently drawn stroke *for the slice currently on screen*.
  const [redoStacks, setRedoStacks] = useState<Record<string, ViewerAnnotation[]>>({});
  const [brushColor, setBrushColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [brushSize, setBrushSize] = useState<AnnotationBrushSize>("medium");
  const [brushOpacity, setBrushOpacity] = useState(1);

  const [findingEditorOpen, setFindingEditorOpen] = useState(false);
  const [findingEditorAnnotationId, setFindingEditorAnnotationId] = useState<string | null>(null);
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ annotationId: string; findingId: string } | null>(null);

  // Wraps the whole viewer column (toolbar + image + slice controls) so
  // navigation isn't lost when the user goes fullscreen.
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const activeSeries = study.series.find((s) => s.id === activeSeriesId) ?? study.series[0];
  const isProcessing = study.status === "queued" || study.status === "processing";
  const activeFindingId = hoveredId ?? selectedId;
  const sliceKey = `${activeSeries?.id ?? ""}:${currentSlice}`;
  const reportPanelContent = useMemo(() => resolveReportPanelContent(study), [study]);

  const visibleFindings = useMemo(
    () =>
      study.findings.filter(
        (f) => f.sliceIndex === currentSlice && (!f.seriesId || !activeSeries || f.seriesId === activeSeries.id)
      ),
    [study.findings, currentSlice, activeSeries]
  );

  /* What the overlay actually draws. Empty in Original view. */
  const overlayFindings = annotatedView ? visibleFindings : [];

  /*
   * Findings anywhere on the current series, not just the current slice — what
   * the Annotated switch needs in order to know whether there is anything to
   * jump to, and where.
   */
  const seriesFindings = useMemo(
    () => study.findings.filter((f) => !f.seriesId || !activeSeries || f.seriesId === activeSeries.id),
    [study.findings, activeSeries]
  );

  /*
   * Which series the study's boxes are actually on, and whether that is the one
   * being looked at.
   *
   * `simulateFindings` puts every box on a single reference series on purpose: a
   * region derived from "right lower lobe" describes a frontal or axial image and
   * would be meaningless replayed onto a sagittal slice, where the horizontal
   * axis is anterior-posterior and there is no left or right. So on a
   * multi-series study most series legitimately carry nothing — measured over the
   * manifest, boxes land on 271 of 3,508 MRI series and 490 of 2,940 PET series.
   *
   * The switch used to be gated on the *active* series having findings, which
   * meant it was absent on almost every MRI and PET series and present on every
   * X-Ray (those have exactly one series). That is the reason the feature looked
   * like it existed only for X-Ray. It is now offered whenever the study has any
   * finding at all, and turning it on navigates to where they are.
   */
  const annotatedSeries = useMemo(() => {
    const first = study.findings[0];
    if (!first?.seriesId) return undefined;
    return study.series.find((s) => s.id === first.seriesId);
  }, [study.findings, study.series]);

  const annotationsElsewhere = seriesFindings.length === 0 && study.findings.length > 0;

  const currentMarkers = useMemo(
    () => markers.filter((m) => m.seriesId === activeSeries?.id && m.sliceIndex === currentSlice),
    [markers, activeSeries, currentSlice]
  );
  const currentMeasurements = useMemo(
    () => measurements.filter((m) => m.seriesId === activeSeries?.id && m.sliceIndex === currentSlice),
    [measurements, activeSeries, currentSlice]
  );
  const currentAnnotations = useMemo(
    () => annotations.filter((a) => a.seriesId === activeSeries?.id && a.sliceIndex === currentSlice),
    [annotations, activeSeries, currentSlice]
  );
  const canUndo = currentAnnotations.length > 0;
  const canRedo = (redoStacks[sliceKey]?.length ?? 0) > 0;

  // Prefer real per-series images (future PACS-ready shape) over the flat
  // study-level upload list, falling back to the synthetic placeholder when
  // neither exists — never fabricated, just whatever real data is present.
  //
  // Looked up by `ViewerImage.index`, not by array position: an adapter that
  // skipped an unreadable instance leaves a gap, and positional access would
  // then quietly display the wrong slice (off-by-N for every slice after the
  // gap) while the slider still read "12/220".
  //
  // How long that takes is measured for the dev-only performance log: it is the
  // whole cost of "work out what order the slices go in" on the client, because
  // the order arrived precomputed in the manifest. Written to a ref rather than
  // logged here so the print happens in an effect, not during render.
  const indexBuildMs = useRef(0);
  const imageByIndex = useMemo(() => {
    const started = perfNow();
    const map = new Map<number, ViewerImage>();
    for (const img of activeSeries?.images ?? []) map.set(img.index, img);
    indexBuildMs.current = perfNow() - started;
    return map;
  }, [activeSeries]);

  /**
   * The image URL for any slice position in the active series.
   *
   * One resolver for all three consumers — the viewer, the filmstrip and the
   * preloader — because they have to agree. A preloader warming a URL the viewer
   * would not have asked for is a wasted 515 KB, and a filmstrip resolving
   * differently from the viewer shows a tile that is not the slice it links to.
   */
  const imageUrlAt = useCallback(
    (index: number) =>
      imageByIndex.get(index)?.imageUrl ??
      (study.imageUrls && study.imageUrls.length > 0 ? study.imageUrls[index % study.imageUrls.length] : undefined),
    [imageByIndex, study.imageUrls]
  );

  const getSeriesImageUrl = useCallback(
    (s: SeriesInfo, index: number) => {
      if (s.images && s.images.length > 0) {
        const match = s.images.find((img) => img.index === index) ?? s.images[index % s.images.length];
        if (match?.imageUrl) return match.imageUrl;
      }
      if (study.imageUrls && study.imageUrls.length > 0) {
        return study.imageUrls[index % study.imageUrls.length];
      }
      return undefined;
    },
    [study.imageUrls]
  );

  const activeImageUrl = imageUrlAt(currentSlice);

  /*
   * A real indexed dataset study is expected to have a URL for every slice, so a
   * missing one is a genuine error worth surfacing. A seeded demo study has no
   * files at all by design and must keep its synthetic placeholder.
   */
  const isDatasetStudy = Boolean(study.datasetSource);
  const hasImageData = !isDatasetStudy || Boolean(activeImageUrl);

  /*
   * Cine backpressure: cleared the moment the slice changes, set when that
   * slice's pixels finish decoding. Placeholder-only studies have nothing to
   * wait for, so they report ready immediately and play at full rate.
   */
  const imageReadyRef = useRef(false);
  useEffect(() => {
    imageReadyRef.current = false;
  }, [activeImageUrl]);

  /*
   * Clamp when the series shrinks under us (series switch, or a re-index that
   * dropped instances). Without this, `currentSlice` could sit past the end and
   * the viewer would render nothing while the strip highlighted a tile that no
   * longer exists.
   */
  useEffect(() => {
    if (!activeSeries) return;
    const last = Math.max(0, activeSeries.sliceCount - 1);
    setCurrentSlice((prev) => (prev > last ? last : prev));
  }, [activeSeries]);

  /*
   * A series with no reconstructed volume can never show 3-D, so drop out of it
   * rather than leaving the viewer on a mode that would 404 the volume route.
   */
  const volumeAvailable = Boolean(activeSeries?.volumeAvailable);
  useEffect(() => {
    if (!volumeAvailable) setView3D(false);
  }, [volumeAvailable]);

  /*
   * Keeps the slices around this one warm, leaning in the direction of travel.
   * Held off while the 3-D view is up: nothing is paging through slices then, and
   * the volume shader wants the bandwidth.
   */
  useSlicePrefetch({
    total: activeSeries?.sliceCount ?? 0,
    current: currentSlice,
    urlAt: imageUrlAt,
    enabled: !view3D,
    playing,
  });

  /*
   * Dev-only instrumentation for the slice pipeline. Every number below is a real
   * measurement — `perf.ts` folds to nothing in a production build, and none of
   * this changes what the viewer does.
   *
   * The study header runs during render, not in an effect, because effects fire
   * child-first: by the time this component's effect ran, <ScanThumbnail> had
   * already requested the first slice, and opening the measurement window then
   * would discard the one timing that matters most. The ref guard keeps it to once
   * per study and series.
   */
  const perfMark = useRef<string | undefined>(undefined);
  if (activeSeries && perfMark.current !== `${study.studyId}:${activeSeries.id}`) {
    perfMark.current = `${study.studyId}:${activeSeries.id}`;
    ctPerfNewStudy(`${study.studyId} · ${activeSeries.label}`);
    ctPerfSliceIndex(activeSeries.sliceCount, indexBuildMs.current);
  }

  /**
   * Where the current slice came from, and how long it took to appear.
   *
   * Recorded when the slice changes and printed when the pixels are on screen, so
   * the elapsed figure is the wait the reader actually experienced rather than the
   * time some internal stage took. `cached` is read at request time, which is why
   * a revisited slice reports a hit and a near-zero wait instead of pretending the
   * pipeline got faster.
   */
  const sliceWatch = useRef<{ url?: string; at: number; cached: boolean; logged: boolean }>({
    at: 0,
    cached: false,
    logged: true,
  });
  useEffect(() => {
    if (!isDecodableUrl(activeImageUrl)) {
      sliceWatch.current = { at: 0, cached: false, logged: true };
      return;
    }
    sliceWatch.current = {
      url: activeImageUrl,
      at: perfNow(),
      cached: peekSlice(activeImageUrl) !== undefined,
      logged: false,
    };
  }, [activeImageUrl]);

  const onImageReady = useCallback(() => {
    imageReadyRef.current = true;
    const watch = sliceWatch.current;
    if (watch.logged || watch.url === undefined) return;
    watch.logged = true;
    ctPerfCurrentSlice(currentSlice, activeSeries?.sliceCount ?? 0, watch.cached, perfNow() - watch.at);
  }, [currentSlice, activeSeries?.sliceCount]);

  const onSelectSeries = useCallback((id: string) => {
    setActiveSeriesId(id);
    setCurrentSlice(0);
    setPlaying(false);
    setView3D(false);
    setSelectedAnnotationId(null);
    // Viewer settings (zoom/pan/brightness/contrast/invert) intentionally persist across series switches.
  }, []);

  const onChangeSlice = useCallback(
    (n: number) => {
      if (!activeSeries) return;
      setCurrentSlice(Math.max(0, Math.min(activeSeries.sliceCount - 1, n)));
      setSelectedAnnotationId(null);
    },
    [activeSeries]
  );

  const onSelectFinding = useCallback(
    (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
      const finding = study.findings.find((f) => f.id === id);
      if (!finding) return;
      const targetSeriesId = finding.seriesId ?? activeSeries?.id;
      if (targetSeriesId && targetSeriesId !== activeSeriesId) {
        setActiveSeriesId(targetSeriesId);
      }
      setCurrentSlice(finding.sliceIndex);
      setPlaying(false);
      setSelectedAnnotationId(null);
      /*
       * "Show on scan" has to actually show it.
       *
       * Navigating to the right series and slice while the overlay was switched
       * off landed the viewer on a slice with nothing drawn on it — which reads as
       * a broken button rather than as Original view behaving correctly. And a
       * finding region is a 2-D box on one slice, so it cannot be drawn over the
       * ray-marched volume: leave 3-D for the same reason the Annotated switch
       * does. Both are no-ops when the reader is already in the annotated 2-D
       * view, which is the common case.
       */
      setAnnotatedView(true);
      setView3D(false);
      // Focus the finding: bring the full frame back into view so its
      // bounding box (drawn in unpanned, unzoomed coordinates) is visible.
      setViewerState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0 }));
    },
    [study.findings, activeSeries, activeSeriesId]
  );

  /*
   * Turning annotations on has to also *land* on something. `visibleFindings`
   * filters to the exact slice on screen, so on a 1,140-slice PET stack the
   * switch would otherwise look broken: every box sits on one reference slice
   * and the viewer is nowhere near it. If nothing is visible where we are, go to
   * the first annotated slice on this series — and if this series carries none,
   * switch to the series that does rather than leaving the reader on a blank
   * overlay with no way to find the marks.
   */
  const onToggleAnnotated = useCallback(
    (next: boolean) => {
      setAnnotatedView(next);
      if (!next || visibleFindings.length > 0) return;
      const target = seriesFindings[0] ?? study.findings[0];
      if (!target) return;
      if (target.seriesId && target.seriesId !== activeSeries?.id) {
        setActiveSeriesId(target.seriesId);
        // A box is a 2-D region on one slice, so it cannot be shown against the
        // ray-marched volume; drop out of 3-D as the series changes.
        setView3D(false);
        setSelectedAnnotationId(null);
      }
      setCurrentSlice(target.sliceIndex);
      setPlaying(false);
      setViewerState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0 }));
    },
    [visibleFindings, seriesFindings, study.findings, activeSeries]
  );

  const onJumpToMarker = useCallback((marker: Marker) => {
    setActiveSeriesId(marker.seriesId);
    setCurrentSlice(marker.sliceIndex);
    setPlaying(false);
    setSelectedAnnotationId(null);
    setViewerState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0 }));
  }, []);

  const onAddMarker = useCallback(
    (m: { id: string; x: number; y: number }) => {
      if (!activeSeries) return;
      setMarkers((prev) => [...prev, { ...m, seriesId: activeSeries.id, sliceIndex: currentSlice, createdAt: new Date().toISOString() }]);
    },
    [activeSeries, currentSlice]
  );
  const onUpdateMarkerNote = useCallback((id: string, note: string) => {
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, note } : m)));
  }, []);
  const onDeleteMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const onAddMeasurement = useCallback(
    (m: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; distancePx: number }) => {
      if (!activeSeries) return;
      setMeasurements((prev) => [...prev, { ...m, seriesId: activeSeries.id, sliceIndex: currentSlice }]);
    },
    [activeSeries, currentSlice]
  );

  const onClearAnnotations = useCallback(() => {
    if (!activeSeries) return;
    setMarkers((prev) => prev.filter((m) => !(m.seriesId === activeSeries.id && m.sliceIndex === currentSlice)));
    setMeasurements((prev) => prev.filter((m) => !(m.seriesId === activeSeries.id && m.sliceIndex === currentSlice)));
  }, [activeSeries, currentSlice]);

  // ---- Pen annotation handlers --------------------------------------------

  const onCommitStroke = useCallback(
    (points: { x: number; y: number }[]) => {
      if (!activeSeries) return;
      const now = new Date().toISOString();
      const stroke: ViewerAnnotation = {
        id: newId("ann"),
        studyId: study.studyId,
        seriesId: activeSeries.id,
        sliceIndex: currentSlice,
        type: "freehand",
        points,
        color: brushColor,
        strokeWidth: BRUSH_WIDTH_PX[brushSize],
        opacity: brushOpacity,
        createdAt: now,
        updatedAt: now,
      };
      setAnnotations((prev) => [...prev, stroke]);
      // A fresh stroke invalidates whatever was previously undone on this slice.
      setRedoStacks((prev) => ({ ...prev, [sliceKey]: [] }));
      setSelectedAnnotationId(stroke.id);
    },
    [activeSeries, currentSlice, study.studyId, brushColor, brushSize, brushOpacity, sliceKey]
  );

  const onCommitAnnotation = useCallback(
    (ann: ViewerAnnotation) => {
      if (!activeSeries) return;
      const fullAnn: ViewerAnnotation = {
        ...ann,
        id: ann.id || newId("ann"),
        studyId: study.studyId,
        seriesId: activeSeries.id,
        sliceIndex: currentSlice,
        color: ann.color || brushColor,
        strokeWidth: ann.strokeWidth || BRUSH_WIDTH_PX[brushSize],
        opacity: ann.opacity ?? brushOpacity,
        createdAt: ann.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setAnnotations((prev) => [...prev, fullAnn]);
      setRedoStacks((prev) => ({ ...prev, [sliceKey]: [] }));
      setSelectedAnnotationId(fullAnn.id);
    },
    [activeSeries, currentSlice, study.studyId, brushColor, brushSize, brushOpacity, sliceKey]
  );

  const onJumpToAnnotation = useCallback((ann: ViewerAnnotation) => {
    setActiveSeriesId(ann.seriesId);
    setCurrentSlice(ann.sliceIndex);
    setPlaying(false);
    setSelectedAnnotationId(ann.id);
    setViewerState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0 }));
  }, []);

  const onUndo = useCallback(() => {
    if (!activeSeries || currentAnnotations.length === 0) return;
    const last = [...currentAnnotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop()!;
    setAnnotations((prev) => prev.filter((a) => a.id !== last.id));
    setRedoStacks((prev) => ({ ...prev, [sliceKey]: [...(prev[sliceKey] ?? []), last] }));
    setSelectedAnnotationId((prev) => (prev === last.id ? null : prev));
  }, [activeSeries, currentAnnotations, sliceKey]);

  const onRedo = useCallback(() => {
    const stack = redoStacks[sliceKey];
    if (!stack || stack.length === 0) return;
    const restored = stack[stack.length - 1];
    setAnnotations((prev) => [...prev, restored]);
    setRedoStacks((prev) => ({ ...prev, [sliceKey]: prev[sliceKey].slice(0, -1) }));
  }, [redoStacks, sliceKey]);

  const onQuickAnnotationNote = useCallback((id: string, note: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, radiologistNote: note, updatedAt: new Date().toISOString() } : a)));
  }, []);

  const removeAnnotation = useCallback((id: string, alsoDeleteFinding: boolean) => {
    setAnnotations((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.findingId) {
        if (alsoDeleteFinding) {
          setRadiologistFindings((f) => f.filter((rf) => rf.id !== target.findingId));
        } else {
          setRadiologistFindings((f) => f.map((rf) => (rf.id === target.findingId ? { ...rf, annotationId: undefined } : rf)));
        }
      }
      return prev.filter((a) => a.id !== id);
    });
    setSelectedAnnotationId((prev) => (prev === id ? null : prev));
  }, []);

  const onRequestDeleteAnnotation = useCallback(
    (id: string) => {
      const target = annotations.find((a) => a.id === id);
      if (target?.findingId) {
        setDeleteConfirm({ annotationId: id, findingId: target.findingId });
      } else {
        removeAnnotation(id, false);
      }
    },
    [annotations, removeAnnotation]
  );

  const onClearPenAnnotations = useCallback(() => {
    if (!activeSeries) return;
    // Bulk clear: detach (don't delete) any attached findings — the cleaner
    // UX for a multi-stroke action than prompting once per annotation.
    const idsToRemove = new Set(currentAnnotations.map((a) => a.id));
    const findingIdsToDetach = new Set(currentAnnotations.map((a) => a.findingId).filter(Boolean) as string[]);
    setAnnotations((prev) => prev.filter((a) => !idsToRemove.has(a.id)));
    if (findingIdsToDetach.size > 0) {
      setRadiologistFindings((prev) => prev.map((f) => (findingIdsToDetach.has(f.id) ? { ...f, annotationId: undefined } : f)));
    }
    setRedoStacks((prev) => ({ ...prev, [sliceKey]: [] }));
    setSelectedAnnotationId(null);
  }, [activeSeries, currentAnnotations, sliceKey]);

  const onExitPenMode = useCallback(() => {
    setViewerState((s) => ({ ...s, tool: "pan" }));
    setSelectedAnnotationId(null);
  }, []);

  const onOpenAddFinding = useCallback((annotationId: string) => {
    setFindingEditorAnnotationId(annotationId);
    setEditingFindingId(null);
    setFindingEditorOpen(true);
  }, []);

  const onOpenEditFinding = useCallback(
    (annotationId: string) => {
      const ann = annotations.find((a) => a.id === annotationId);
      if (!ann?.findingId) return;
      setFindingEditorAnnotationId(annotationId);
      setEditingFindingId(ann.findingId);
      setFindingEditorOpen(true);
    },
    [annotations]
  );

  const onSaveFinding = useCallback(
    (draft: FindingDraft) => {
      if (!activeSeries) return;
      const now = new Date().toISOString();
      const clean = (v: string) => (v.trim().length > 0 ? v : undefined);

      if (editingFindingId) {
        setRadiologistFindings((prev) =>
          prev.map((f) =>
            f.id === editingFindingId
              ? {
                  ...f,
                  text: draft.text,
                  findingType: clean(draft.findingType),
                  location: clean(draft.location),
                  severity: clean(draft.severity),
                  confidence: clean(draft.confidence),
                  radiologistNote: clean(draft.radiologistNote),
                  updatedAt: now,
                }
              : f
          )
        );
      } else {
        const finding: RadiologistFinding = {
          id: newId("rf"),
          studyId: study.studyId,
          seriesId: activeSeries.id,
          sliceIndex: currentSlice,
          annotationId: findingEditorAnnotationId ?? undefined,
          text: draft.text,
          findingType: clean(draft.findingType),
          location: clean(draft.location),
          severity: clean(draft.severity),
          confidence: clean(draft.confidence),
          radiologistNote: clean(draft.radiologistNote),
          author: CURRENT_USER,
          createdAt: now,
          updatedAt: now,
          addedToReport: false,
        };
        setRadiologistFindings((prev) => [...prev, finding]);
        if (findingEditorAnnotationId) {
          setAnnotations((prev) =>
            prev.map((a) => (a.id === findingEditorAnnotationId ? { ...a, findingId: finding.id, updatedAt: now } : a))
          );
        }
      }
      setFindingEditorOpen(false);
      setFindingEditorAnnotationId(null);
      setEditingFindingId(null);
    },
    [activeSeries, currentSlice, study.studyId, editingFindingId, findingEditorAnnotationId]
  );

  const onSelectRadiologistFinding = useCallback(
    (id: string) => {
      const finding = radiologistFindings.find((f) => f.id === id);
      if (!finding) return;
      if (finding.seriesId !== activeSeriesId) setActiveSeriesId(finding.seriesId);
      setCurrentSlice(finding.sliceIndex);
      setPlaying(false);
      setViewerState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0, tool: "pen" }));
      setSelectedAnnotationId(finding.annotationId ?? null);
    },
    [radiologistFindings, activeSeriesId]
  );

  const onEditRadiologistFinding = useCallback(
    (id: string) => {
      const finding = radiologistFindings.find((f) => f.id === id);
      if (!finding) return;
      setFindingEditorAnnotationId(finding.annotationId ?? null);
      setEditingFindingId(id);
      setFindingEditorOpen(true);
    },
    [radiologistFindings]
  );

  const onDeleteRadiologistFinding = useCallback((id: string) => {
    setRadiologistFindings((prev) => prev.filter((f) => f.id !== id));
    setAnnotations((prev) => prev.map((a) => (a.findingId === id ? { ...a, findingId: undefined } : a)));
  }, []);

  const onAddRadiologistFindingToReport = useCallback(
    (id: string) => {
      const finding = radiologistFindings.find((f) => f.id === id);
      if (!finding || finding.addedToReport) return;
      onAppendFindingToReport(finding.text);
      setRadiologistFindings((prev) => prev.map((f) => (f.id === id ? { ...f, addedToReport: true } : f)));
    },
    [radiologistFindings, onAppendFindingToReport]
  );

  const editingFinding = editingFindingId ? radiologistFindings.find((f) => f.id === editingFindingId) ?? null : null;
  const findingEditorLocationLabel = activeSeries
    ? study.series.length > 1
      ? `${activeSeries.label} · Slice ${currentSlice + 1}`
      : activeSeries.sliceCount > 1
      ? `Slice ${currentSlice + 1}`
      : undefined
    : undefined;

  const onFullscreen = () => {
    if (fullscreenRef.current?.requestFullscreen) fullscreenRef.current.requestFullscreen();
  };

  // Keyboard navigation: arrows step slices, Space toggles cine. Disabled
  // while a text field (e.g. a marker note) has focus, and while the 3-D view
  // is up — there are no slices to step through in a volume render.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !activeSeries || view3D) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        onChangeSlice(currentSlice - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        onChangeSlice(currentSlice + 1);
      } else if (e.key === " " || e.code === "Space") {
        if (activeSeries.sliceCount > 1) {
          e.preventDefault();
          setPlaying((p) => !p);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSeries, currentSlice, onChangeSlice, view3D]);

  if (!activeSeries || study.series.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center p-6">
        <EmptyState icon={Layers} title="No series available" description="This study doesn't have any image series to display yet." />
      </div>
    );
  }

  /* ── Full-screen MONAI Workspace ────────────────────────────── */
  if (monaiOpen) {
    return (
      <div className="h-[calc(100dvh-56px)] overflow-hidden" style={{ contain: "strict" }}>
        <AIAnalysisPanel
          studyId={study.id}
          seriesId={activeSeries.id}
          modality={study.modality}
          priorStudyId={allStudies?.find((s) => s.id !== study.id)?.id}
          organMeshes={organMeshes}
          onOrganMeshesChange={setOrganMeshes}
          onTriggerRegistration={() => setRightTab("comparison")}
          onAppendFindingToReport={onAppendFindingToReport}
          onOpenReportTab={onOpenReportTab}
          onJumpToSlice={(slice) => setCurrentSlice(slice)}
          fullscreen={true}
          onClose={() => setMonaiOpen(false)}
          patientAlias={study.patientAlias}
          studyDescription={`${study.modality} · ${activeSeries.label}`}
        />
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-56px)] grid-cols-1 lg:grid-cols-[220px_1fr_320px]">
      <div className="hidden overflow-y-auto border-r border-border bg-panel lg:block">
        <SeriesNavigator series={study.series} activeSeriesId={activeSeries.id} onSelect={onSelectSeries} />
      </div>

      <div ref={fullscreenRef} className="flex flex-col gap-3 bg-base p-4 [&:fullscreen]:justify-center [&:fullscreen]:bg-black">
        {/* Critical Findings Statutory Banner */}
        <CriticalFindingBanner
          studyId={study.id}
          findings={study.findings}
          acknowledgedIds={acknowledgedCriticalIds}
          onAcknowledge={(findingId, action, note) => {
            setAcknowledgedCriticalIds((prev) => [...prev, findingId]);
            if (action === "confirmed") {
              const finding = study.findings.find((f) => f.id === findingId);
              if (finding) {
                onAppendFindingToReport(`CRITICAL FINDING: ${finding.label} (${finding.location || "Thoracic"}). Clinical handover documented.`);
              }
            }
          }}
          onJumpToSlice={onChangeSlice}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto">
            <ViewerToolbar
              state={viewerState}
              setState={setViewerState}
              onFullscreen={onFullscreen}
              currentLayout={layout}
              onSelectLayout={setLayout}
            />
          </div>
          <div className="flex w-full items-center gap-1.5 overflow-x-auto sm:w-auto sm:gap-2 lg:hidden">
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setMobileSeriesOpen(true)}>
              <Layers className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Series</span>
            </Button>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setMobileFindingsOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Findings</span> ({study.findings.length})
            </Button>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setMobileReportOpen(true)}>
              <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Report</span>
            </Button>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setMobileMarkersOpen(true)}>
              <MapPin className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Annotations</span> ({markers.length + radiologistFindings.length})
            </Button>
          </div>
          <div className="hidden lg:flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px]">
              {autoSaveStatus === "saving" ? (
                <span className="animate-pulse text-amber-400">Saving…</span>
              ) : (
                <span className="text-emerald-400">✓ Auto-saved</span>
              )}
            </span>
            <span className="text-border-strong">•</span>
            <p className="text-[11.5px] text-ink-muted">
              {activeSeries.label} · {study.modality}
            </p>
          </div>
        </div>

        {/*
          Original / Annotated. Offered for every modality that has anything to
          annotate — the switch is driven by `study.findings`, not by a
          per-modality list, so CT, MRI, PET, ultrasound and mammography get it
          on exactly the same terms the X-ray demo always had.

          Hidden in 3-D: `Finding.region` is a 2-D bbox on one slice and has no
          meaning against a ray-marched volume.
        */}
        {!view3D && study.findings.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border-strong">
              <button
                onClick={() => onToggleAnnotated(false)}
                aria-pressed={!annotatedView}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide transition-colors",
                  !annotatedView ? "bg-[rgb(var(--overlay-hover)/0.10)] text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                )}
              >
                <ImageIcon className="h-3 w-3" /> Original
              </button>
              <button
                onClick={() => onToggleAnnotated(true)}
                aria-pressed={annotatedView}
                className={cn(
                  "flex items-center gap-1.5 border-l border-border-strong px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide transition-colors",
                  annotatedView ? "bg-[rgb(var(--overlay-hover)/0.10)] text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                )}
              >
                <Sparkles className="h-3 w-3" /> Annotated
              </button>
            </div>
            <p className="hidden text-[11px] text-ink-muted sm:block">
              {!annotatedView
                ? "Unmarked image."
                : annotationsElsewhere
                  ? /* The marks are on another series. Name it, because the reader
                       otherwise has no way to tell an empty overlay from a broken one. */
                    `Marked on the ${annotatedSeries?.label ?? "reference"} series — press Annotated to go there.`
                  : visibleFindings.length === 0
                    ? /* Annotated is on but this slice carries nothing. Saying so beats an
                         apparently broken overlay, and naming the slice is the fix. */
                      `Nothing marked on this slice — findings are on slice ${seriesFindings[0].sliceIndex + 1}.`
                    : study.aiStatus === "simulated"
                      ? "Boxes are simulated from the report wording — not a detection."
                      : "Each box marks a reported finding."}
            </p>
          </div>
        )}

        {/*
          2D / 3D switch. Rendered only for a series something can actually build a
          volume for — an indexed DICOM stack on the server, a committed NIfTI the
          browser inflates itself, or a committed DICOM series long enough to stack a
          run of its files — so it never promises a view the data can't back.
        */}
        {volumeAvailable && (
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border-strong">
              <button
                onClick={() => setView3D(false)}
                aria-pressed={!view3D}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide transition-colors",
                  !view3D ? "bg-[rgb(var(--overlay-hover)/0.10)] text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                )}
              >
                <Square className="h-3 w-3" /> 2D planes
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setView3D(true);
                }}
                aria-pressed={view3D}
                className={cn(
                  "flex items-center gap-1.5 border-l border-border-strong px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide transition-colors",
                  view3D ? "bg-[rgb(var(--overlay-hover)/0.10)] text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                )}
              >
                <Box className="h-3 w-3" /> 3D volume
              </button>
            </div>
            <p className="hidden text-[11px] text-ink-muted sm:block">
              {view3D
                ? "Ray-marched from the reconstructed stack — drag to orbit."
                : "This series is reconstructed, so it can also be viewed as a volume."}
            </p>
          </div>
        )}

        {viewerState.tool === "pen" && !view3D && (
          <div className="max-w-full overflow-x-auto">
            <AnnotationToolbar
              color={brushColor}
              setColor={setBrushColor}
              size={brushSize}
              setSize={setBrushSize}
              opacity={brushOpacity}
              setOpacity={setBrushOpacity}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={onUndo}
              onRedo={onRedo}
              onClear={onClearPenAnnotations}
              onExit={onExitPenMode}
              strokeCount={currentAnnotations.length}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 rounded-lg bg-black">
          {layout !== "1x1" ? (
            <MultiPlaneGrid
              study={study}
              layout={layout}
              globalViewerState={viewerState}
              findings={overlayFindings}
              activeFindingId={activeFindingId}
              onHoverFinding={setHoveredId}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={(m) => setMarkers((prev) => [...prev, { ...m, createdAt: new Date().toISOString() }])}
              measurements={measurements}
              onAddMeasurement={(m) => setMeasurements((prev) => [...prev, m])}
              annotations={annotations}
              onCommitAnnotation={(ann) => setAnnotations((prev) => [...prev, { ...ann, studyId: study.studyId }])}
              onDeleteAnnotation={onRequestDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onOpenAddFinding}
              onEditFinding={onOpenEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={setAnnotations3D}
              getImageUrl={getSeriesImageUrl}
              organMeshes={organMeshes}
              onOrganMeshesChange={setOrganMeshes}
            />
          ) : view3D ? (
            <ViewerErrorBoundary fallbackTitle="3D Volumetric Reconstruction Unavailable">
              <Volume3DViewer
                studyId={study.id}
                seriesId={activeSeries.id}
                modality={study.modality}
                volumeUrl={imageUrlAt(0)}
                sliceCount={activeSeries.sliceCount}
                sliceUrlAt={imageUrlAt}
                initialAnnotations={annotations3D}
                onAnnotationsChange={setAnnotations3D}
                findings={study.findings}
                activeFindingId={activeFindingId}
                onSelectFinding={onSelectFinding}
                crosshairPos={
                  activeSeries.sliceCount > 1
                    ? { x: 0.5, y: 0.5, z: currentSlice / Math.max(1, activeSeries.sliceCount - 1) }
                    : null
                }
                onPointSelected={(pt) => {
                  if (activeSeries.sliceCount > 1) {
                    const targetSlice = Math.max(
                      0,
                      Math.min(activeSeries.sliceCount - 1, Math.round(pt.z * (activeSeries.sliceCount - 1)))
                    );
                    onChangeSlice(targetSlice);
                    setView3D(false);
                  }
                }}
                organMeshes={organMeshes}
                onOrganMeshesChange={setOrganMeshes}
              />
            </ViewerErrorBoundary>
          ) : (
            <ImageViewer
              modality={study.modality}
              seed={study.thumbnailSeed + currentSlice}
              imageUrl={activeImageUrl}
              isProcessing={isProcessing}
              findings={overlayFindings}
              activeFindingId={activeFindingId}
              onHoverFinding={setHoveredId}
              onSelectFinding={onSelectFinding}
              viewerState={viewerState}
              setViewerState={setViewerState}
              markers={currentMarkers}
              onAddMarker={onAddMarker}
              onUpdateMarkerNote={onUpdateMarkerNote}
              onDeleteMarker={onDeleteMarker}
              measurements={currentMeasurements}
              onAddMeasurement={onAddMeasurement}
              onClearAnnotations={onClearAnnotations}
              hasImageData={hasImageData}
              onImageReady={onImageReady}
              resetKey={`${activeSeries.id}:${currentSlice}`}
              sliceLabel={activeSeries.sliceCount > 1 ? `Slice ${currentSlice + 1} / ${activeSeries.sliceCount}` : undefined}
              orientation={activeSeries.orientation}
              seriesLabel={activeSeries.label}
              patientAlias={study.patientAlias}
              pixelSpacing={activeSeries.pixelSpacing}
              annotations={currentAnnotations}
              brushColor={brushColor}
              brushSizePx={BRUSH_WIDTH_PX[brushSize]}
              brushOpacity={brushOpacity}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={setSelectedAnnotationId}
              onCommitStroke={onCommitStroke}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onRequestDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onOpenAddFinding}
              onEditFinding={onOpenEditFinding}
              onSliceScroll={(d) => onChangeSlice(currentSlice + d)}
            />
          )}
        </div>

        {layout === "1x1" && !view3D && activeSeries.sliceCount > 1 && (
          <ThumbnailStrip
            modality={study.modality}
            thumbnailSeed={study.thumbnailSeed}
            total={activeSeries.sliceCount}
            current={currentSlice}
            onChange={onChangeSlice}
            getImageUrl={imageUrlAt}
          />
        )}

        {layout === "1x1" && !view3D && activeSeries.sliceCount > 1 && (
          <SliceNavigator
            current={currentSlice}
            total={activeSeries.sliceCount}
            onChange={onChangeSlice}
            orientation={activeSeries.orientation}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            ready={() => (activeImageUrl ? peekSlice(activeImageUrl) !== undefined || imageReadyRef.current : true)}
          />
        )}
      </div>

      <div className="hidden flex-col overflow-hidden border-l border-border bg-panel lg:flex">
        <div className="flex shrink-0 border-b border-border">
          {RIGHT_PANEL_TABS.map((t) => {
            const Icon = t.icon;
            const count = t.key === "ai" ? study.findings.length : t.key === "annotations" ? markers.length + radiologistFindings.length : undefined;
            return (
              <button
                key={t.key}
                onClick={() => setRightTab(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-[11.5px] font-medium transition-colors",
                  rightTab === t.key ? "border-clinical text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
                {count !== undefined && count > 0 && (
                  <span className="rounded-md bg-[rgb(var(--overlay-hover)/0.08)] px-1 py-0.5 font-mono text-[10px] leading-none text-ink-muted">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {rightTab === "ai" && (
            <FindingsPanel
              mode="ai"
              aiStatus={study.aiStatus ?? "complete"}
              findings={study.findings}
              activeFindingId={activeFindingId}
              onHover={setHoveredId}
              onSelect={onSelectFinding}
              onUpdate={onUpdateFinding}
              isProcessing={isProcessing}
              series={study.series}
            />
          )}

          {rightTab === "ai3d" && (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Entry point card */}
              <div className="shrink-0 border-b border-border bg-panel-alt/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-clinical/15 text-clinical">
                    <Boxes className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-ink-primary">MONAI Physio AI Workstation</span>
                </div>
                <p className="text-[11px] text-ink-muted mb-3">Full 3D Anatomy, 4D Motion, Findings &amp; Report workspace. Opens in full screen for optimal analysis.</p>
                <Button
                  size="sm"
                  variant="primary"
                  className="w-full gap-1.5"
                  onClick={() => setMonaiOpen(true)}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Open MONAI Workspace
                  <span className="ml-auto opacity-70">→</span>
                </Button>
              </div>
              {/* Compact preview panel for quick status */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AIAnalysisPanel
                  studyId={study.id}
                  seriesId={activeSeries.id}
                  modality={study.modality}
                  priorStudyId={allStudies?.find((s) => s.id !== study.id)?.id}
                  organMeshes={organMeshes}
                  onOrganMeshesChange={setOrganMeshes}
                  onTriggerRegistration={() => setRightTab("comparison")}
                  onAppendFindingToReport={onAppendFindingToReport}
                  onOpenReportTab={onOpenReportTab}
                  onJumpToSlice={(slice) => setCurrentSlice(slice)}
                />
              </div>
            </div>
          )}

          {rightTab === "comparison" && (
            <PriorComparisonPanel
              currentStudy={study}
              allStudies={allStudies}
              onApplyIntervalSummaryToReport={onAppendFindingToReport}
            />
          )}

          {rightTab === "report" && <RadiologyReportPanel sourceReport={reportPanelContent} onOpenFullReport={onOpenReportTab} />}

          {rightTab === "annotations" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FindingsPanel
                  mode="radiologist"
                  findings={study.findings}
                  activeFindingId={activeFindingId}
                  onHover={setHoveredId}
                  onSelect={onSelectFinding}
                  onUpdate={onUpdateFinding}
                  isProcessing={isProcessing}
                  series={study.series}
                  radiologistFindings={radiologistFindings}
                  onSelectRadiologistFinding={onSelectRadiologistFinding}
                  onEditRadiologistFinding={onEditRadiologistFinding}
                  onDeleteRadiologistFinding={onDeleteRadiologistFinding}
                  onAddRadiologistFindingToReport={onAddRadiologistFindingToReport}
                />
              </div>
              <div className="h-[260px] shrink-0 overflow-hidden border-t border-border">
                <MarkersPanel
                  markers={markers}
                  series={study.series}
                  activeSeriesId={activeSeries.id}
                  currentSlice={currentSlice}
                  onJump={onJumpToMarker}
                  onDelete={onDeleteMarker}
                  annotations={annotations}
                  measurements={measurements}
                  annotations3D={annotations3D}
                  onDeleteAnnotation={onRequestDeleteAnnotation}
                  onJumpToAnnotation={onJumpToAnnotation}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Drawer open={mobileReportOpen} onClose={() => setMobileReportOpen(false)} title="Radiology Report" widthClassName="w-full max-w-sm">
        <RadiologyReportPanel
          sourceReport={reportPanelContent}
          onOpenFullReport={
            onOpenReportTab
              ? () => {
                  onOpenReportTab();
                  setMobileReportOpen(false);
                }
              : undefined
          }
        />
      </Drawer>

      <Drawer open={mobileSeriesOpen} onClose={() => setMobileSeriesOpen(false)} title="Series" widthClassName="w-full max-w-xs">
        <SeriesNavigator
          series={study.series}
          activeSeriesId={activeSeries.id}
          onSelect={(id) => {
            onSelectSeries(id);
            setMobileSeriesOpen(false);
          }}
        />
      </Drawer>

      <Drawer open={mobileFindingsOpen} onClose={() => setMobileFindingsOpen(false)} title="AI Findings" widthClassName="w-full max-w-sm">
        <FindingsPanel
          mode="ai"
          aiStatus={study.aiStatus ?? "complete"}
          findings={study.findings}
          activeFindingId={activeFindingId}
          onHover={setHoveredId}
          onSelect={onSelectFinding}
          onUpdate={onUpdateFinding}
          isProcessing={isProcessing}
          series={study.series}
        />
      </Drawer>

      <Drawer open={mobileMarkersOpen} onClose={() => setMobileMarkersOpen(false)} title="Annotations" widthClassName="w-full max-w-sm">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FindingsPanel
              mode="radiologist"
              findings={study.findings}
              activeFindingId={activeFindingId}
              onHover={setHoveredId}
              onSelect={onSelectFinding}
              onUpdate={onUpdateFinding}
              isProcessing={isProcessing}
              series={study.series}
              radiologistFindings={radiologistFindings}
              onSelectRadiologistFinding={(id) => {
                onSelectRadiologistFinding(id);
                setMobileMarkersOpen(false);
              }}
              onEditRadiologistFinding={onEditRadiologistFinding}
              onDeleteRadiologistFinding={onDeleteRadiologistFinding}
              onAddRadiologistFindingToReport={onAddRadiologistFindingToReport}
            />
          </div>
          <div className="h-[220px] shrink-0 overflow-hidden border-t border-border">
            <MarkersPanel
              markers={markers}
              series={study.series}
              activeSeriesId={activeSeries.id}
              currentSlice={currentSlice}
              onJump={(m) => {
                onJumpToMarker(m);
                setMobileMarkersOpen(false);
              }}
              onDelete={onDeleteMarker}
            />
          </div>
        </div>
      </Drawer>

      <AnnotationEditor
        open={findingEditorOpen}
        onClose={() => {
          setFindingEditorOpen(false);
          setFindingEditorAnnotationId(null);
          setEditingFindingId(null);
        }}
        onSave={onSaveFinding}
        editingFinding={editingFinding}
        locationLabel={findingEditorLocationLabel}
      />

      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete this annotation?" size="sm">
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          This drawing has a finding attached to it. You can delete the finding along with it, or keep the finding and just detach it from the
          drawing — it will stay in the Findings panel and, if already added, in the report.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (deleteConfirm) removeAnnotation(deleteConfirm.annotationId, false);
              setDeleteConfirm(null);
            }}
          >
            Keep Finding
          </Button>
          <Button
            variant="critical"
            size="sm"
            onClick={() => {
              if (deleteConfirm) removeAnnotation(deleteConfirm.annotationId, true);
              setDeleteConfirm(null);
            }}
          >
            Delete Finding Too
          </Button>
        </div>
      </Modal>
    </div>
  );
}
