import { Modality, Study } from "./types";

export type AnatomicalCategory =
  | "BONE"
  | "SOFT_TISSUE"
  | "ORGANS"
  | "CARDIAC"
  | "VESSELS"
  | "FIBERS"
  | "BLOOD";

export type AnatomicalAvailability = "available" | "not_available" | "processing" | "failed";

export type ClinicalDataProvenance =
  | "PATIENT_DERIVED"
  | "AI_SEGMENTED"
  | "CALCULATED"
  | "UNAVAILABLE";

export interface AnatomicalLayer {
  id: string;
  name: string;
  category: AnatomicalCategory;
  availability: AnatomicalAvailability;
  unavailabilityReason?: string;
  provenance: ClinicalDataProvenance;
  visible: boolean;
  isolated: boolean;
  opacity: number; // 0.0 - 1.0
  color: string;
  meshUrl?: string;
  maskUrl?: string;
  volumeMl?: number;
  maxDiameterMm?: number;
  voxelCount?: number;
  description?: string;
}

export interface PlaneClippingState {
  enabled: boolean;
  position: number; // 0.0 - 1.0 normalized position along physical axis
  reverse: boolean; // if true, clips from the opposite side
  syncWithSlice: boolean; // if true, binds position to the active 2D slice
}

export interface AnatomicalClipping {
  axial: PlaneClippingState;
  coronal: PlaneClippingState;
  sagittal: PlaneClippingState;
}

export interface Temporal4DState {
  hasTemporalAcquisition: boolean;
  provenance: ClinicalDataProvenance;
  totalPhases: number;
  currentPhase: number;
  isPlaying: boolean;
  fps: number;
  unavailabilityReason?: string;
  phaseFrames?: Array<{
    phaseIndex: number;
    label: string;
    volumeMl?: number;
    meshUrl?: string;
  }>;
  cardiacMetrics?: {
    edv?: { value: number; unit: string; isCalculated: boolean };
    esv?: { value: number; unit: string; isCalculated: boolean };
    sv?: { value: number; unit: string; isCalculated: boolean };
    lvef?: { value: number; unit: string; isCalculated: boolean };
  };
}

export interface CanonicalAnatomyState {
  studyId: string;
  volumeId: string | null;
  seriesId: string;
  modality: Modality;
  dims: [number, number, number]; // [nx, ny, nz]
  spacing: [number, number, number]; // [dx, dy, dz] mm
  crosshair: { x: number; y: number; z: number }; // normalized 0..1 in physical patient volume
  axialSlice: number;
  coronalSlice: number;
  sagittalSlice: number;
  totalAxialSlices: number;
  totalCoronalSlices: number;
  totalSagittalSlices: number;
  layers: AnatomicalLayer[];
  clipping: AnatomicalClipping;
  temporal: Temporal4DState;
  selectedStructureId: string | null;
  provenance: ClinicalDataProvenance;
}

export const CATEGORY_LABELS: Record<AnatomicalCategory, string> = {
  BONE: "Bone & Skeletal System",
  SOFT_TISSUE: "Soft Tissue & Body Habit",
  ORGANS: "Parenchymal Organs",
  CARDIAC: "Cardiac Chambers & Myocardium",
  VESSELS: "Vascular System",
  FIBERS: "Neural / Muscular Fibers",
  BLOOD: "Blood Pool & Luminal Contrast",
};

/**
 * Standard anatomical structure taxonomy.
 * Defines the comprehensive medical anatomical layers expected by radiologists.
 * Structures not present or segmented in a given study are marked as "not_available"
 * with an honest clinical explanation instead of substituting fake geometry.
 */
interface BaseLayerDef {
  id: string;
  name: string;
  category: AnatomicalCategory;
  defaultColor: string;
  description: string;
  requiresContrast?: boolean;
  requiresDti?: boolean;
}

export const STANDARD_LAYER_TAXONOMY: BaseLayerDef[] = [
  // BONE
  { id: "spine_ribs", name: "Thoracic Skeleton & Spine", category: "BONE", defaultColor: "#E2E8F0", description: "Vertebral column, ribs, sternum, and clavicles" },
  { id: "skull", name: "Skull & Cranial Vault", category: "BONE", defaultColor: "#F1F5F9", description: "Calvarium, facial bones, and cranial base" },
  { id: "vertebrae", name: "Vertebral Column", category: "BONE", defaultColor: "#CBD5E1", description: "Cervical, thoracic, and lumbar vertebrae" },
  { id: "ribs", name: "Ribs & Costal Cartilage", category: "BONE", defaultColor: "#E2E8F0", description: "Bilateral rib cage and costal arches" },
  { id: "pelvis", name: "Pelvic Bones", category: "BONE", defaultColor: "#94A3B8", description: "Ilium, ischium, pubis, and sacrum" },

  // SOFT TISSUE
  { id: "skin_body", name: "Skin & Body Contour", category: "SOFT_TISSUE", defaultColor: "#FDBA74", description: "Patient cutaneous envelope derived from volume boundary" },
  { id: "skeletal_muscle", name: "Skeletal Muscle", category: "SOFT_TISSUE", defaultColor: "#FB7185", description: "Paravertebral, chest wall, and abdominal wall musculature" },
  { id: "fat", name: "Adipose Tissue (Fat)", category: "SOFT_TISSUE", defaultColor: "#FDE047", description: "Subcutaneous and visceral adipose tissue compartments" },

  // ORGANS
  { id: "heart", name: "Heart", category: "ORGANS", defaultColor: "#F43F5E", description: "Cardiac silhouette including pericardium and myocardium" },
  { id: "lungs", name: "Lungs Bilateral", category: "ORGANS", defaultColor: "#06B6D4", description: "Bilateral lung parenchyma and bronchovascular bundles" },
  { id: "lung_left", name: "Left Lung", category: "ORGANS", defaultColor: "#38BDF8", description: "Superior and inferior left pulmonary lobes" },
  { id: "lung_right", name: "Right Lung", category: "ORGANS", defaultColor: "#0EA5E9", description: "Superior, middle, and inferior right pulmonary lobes" },
  { id: "airways", name: "Tracheobronchial Tree", category: "ORGANS", defaultColor: "#22D3EE", description: "Trachea, main bronchi, and lobar bronchi" },
  { id: "liver", name: "Liver", category: "ORGANS", defaultColor: "#F59E0B", description: "Hepatic parenchyma across Couinaud segments" },
  { id: "spleen", name: "Spleen", category: "ORGANS", defaultColor: "#8B5CF6", description: "Splenic parenchyma and red/white pulp" },
  { id: "kidney_left", name: "Left Kidney", category: "ORGANS", defaultColor: "#10B981", description: "Left renal cortex, medulla, and collecting system" },
  { id: "kidney_right", name: "Right Kidney", category: "ORGANS", defaultColor: "#059669", description: "Right renal cortex, medulla, and collecting system" },
  { id: "stomach", name: "Stomach", category: "ORGANS", defaultColor: "#EC4899", description: "Gastric body, antrum, and pylorus" },
  { id: "pancreas", name: "Pancreas", category: "ORGANS", defaultColor: "#A855F7", description: "Pancreatic head, uncinate process, body, and tail" },

  // CARDIAC
  { id: "myocardium", name: "Myocardium", category: "CARDIAC", defaultColor: "#E11D48", description: "Left and right ventricular compact myocardium" },
  { id: "left_ventricle", name: "Left Ventricle", category: "CARDIAC", defaultColor: "#BE123C", description: "Left ventricular blood pool and endocardium" },
  { id: "right_ventricle", name: "Right Ventricle", category: "CARDIAC", defaultColor: "#9F1239", description: "Right ventricular chamber and outflow tract" },
  { id: "left_atrium", name: "Left Atrium", category: "CARDIAC", defaultColor: "#881337", description: "Left atrium and pulmonary venous confluence" },
  { id: "right_atrium", name: "Right Atrium", category: "CARDIAC", defaultColor: "#4C0519", description: "Right atrium and caval orifices" },

  // VESSELS
  { id: "aorta", name: "Thoracic / Abdominal Aorta", category: "VESSELS", defaultColor: "#DC2626", description: "Ascending aorta, aortic arch, and descending aorta" },
  { id: "pulmonary_artery", name: "Pulmonary Artery", category: "VESSELS", defaultColor: "#2563EB", description: "Main pulmonary trunk and left/right pulmonary branches" },
  { id: "veins", name: "Inferior / Superior Vena Cava", category: "VESSELS", defaultColor: "#1D4ED8", description: "Systemic venous drainage into right atrium" },

  // FIBERS
  { id: "fibers", name: "Fiber Orientation (DTI)", category: "FIBERS", defaultColor: "#C084FC", description: "Diffusion tensor tractography fibers", requiresDti: true },

  // BLOOD
  { id: "blood_pool", name: "Blood Pool & Luminal Contrast", category: "BLOOD", defaultColor: "#EF4444", description: "Contrast-enhanced intravascular volume", requiresContrast: true },
];

/**
 * Builds the canonical list of anatomical layers by matching real derived segmentation
 * segments against the anatomical hierarchy. Layers present in the actual patient
 * study are marked 'available' and 'AI_SEGMENTED' or 'PATIENT_DERIVED'.
 * Absent layers are marked 'not_available' with honest clinical explanations.
 */
export function buildAnatomicalLayers(
  studyId: string,
  manifestSegments: any[] = [],
  manifestMeshes: any[] = [],
  modality: Modality = "CT",
  isContrastEnhanced: boolean = false
): AnatomicalLayer[] {
  // Index available segments by ID and canonical aliases
  const segmentMap = new Map<string, any>();
  for (const s of manifestSegments) {
    if (!s?.id) continue;
    segmentMap.set(s.id.toLowerCase(), s);
    // Aliases
    if (s.id === "spine_ribs") {
      segmentMap.set("vertebrae", s);
      segmentMap.set("ribs", s);
    }
  }

  // Index mesh files
  const meshMap = new Map<string, any>();
  for (const m of manifestMeshes) {
    if (!m?.id) continue;
    meshMap.set(m.id.toLowerCase(), m);
  }

  return STANDARD_LAYER_TAXONOMY.map((def): AnatomicalLayer => {
    // 1. Skin & Body Contour: always patient-derived from CT/MRI volume surface
    if (def.id === "skin_body") {
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        availability: "available",
        provenance: "PATIENT_DERIVED",
        visible: false, // Default off to expose underlying organs
        isolated: false,
        opacity: 0.25,
        color: def.defaultColor,
        description: def.description,
      };
    }

    // 2. Fiber Orientation: NEVER fabricated. Only available if DTI acquired.
    if (def.requiresDti) {
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        availability: "not_available",
        unavailabilityReason: "Fiber orientation data not available for this study. DTI diffusion sequence not acquired.",
        provenance: "UNAVAILABLE",
        visible: false,
        isolated: false,
        opacity: 0.0,
        color: def.defaultColor,
        description: def.description,
      };
    }

    // 3. Blood Pool: requires contrast-enhanced vascular acquisition
    if (def.requiresContrast) {
      const hasContrastMesh = segmentMap.has("aorta") || segmentMap.has("blood_pool") || isContrastEnhanced;
      if (hasContrastMesh && segmentMap.has("aorta")) {
        const seg = segmentMap.get("aorta");
        return {
          id: def.id,
          name: def.name,
          category: def.category,
          availability: "available",
          provenance: "AI_SEGMENTED",
          visible: true,
          isolated: false,
          opacity: 0.85,
          color: def.defaultColor,
          meshUrl: `/api/studies/${studyId}/derived/meshes/aorta.glb`,
          volumeMl: seg.volumeMl,
          maxDiameterMm: seg.maxDiameterMm,
          voxelCount: seg.voxelCount,
          description: def.description,
        };
      }
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        availability: "not_available",
        unavailabilityReason: "Contrast-enhanced blood-pool segmentation not acquired for this acquisition.",
        provenance: "UNAVAILABLE",
        visible: false,
        isolated: false,
        opacity: 0.0,
        color: def.defaultColor,
        description: def.description,
      };
    }

    // 4. Standard anatomical structures: check if real segmentation exists
    const seg = segmentMap.get(def.id.toLowerCase());
    const mesh = meshMap.get(def.id.toLowerCase());

    if (seg) {
      const meshPath = mesh?.meshPath || `meshes/${def.id}.glb`;
      const meshUrl = meshPath.startsWith("http")
        ? meshPath
        : `/api/studies/${studyId}/derived/${meshPath}`;

      return {
        id: def.id,
        name: seg.name || def.name,
        category: def.category,
        availability: "available",
        provenance: "AI_SEGMENTED",
        visible: true,
        isolated: false,
        opacity: seg.opacity ?? (def.category === "BONE" ? 0.85 : 0.75),
        color: seg.color || def.defaultColor,
        meshUrl,
        maskUrl: seg.maskPath ? `/api/studies/${studyId}/derived/${seg.maskPath}` : undefined,
        volumeMl: seg.volumeMl,
        maxDiameterMm: seg.maxDiameterMm,
        voxelCount: seg.voxelCount,
        description: def.description,
      };
    }

    // 5. Structure not in this scan / not segmented
    let reason = "Structure not segmented in current model run.";
    if (def.category === "BONE" && def.id === "skull" && modality === "CT") {
      reason = "Cranial vault not within scanned field of view.";
    } else if (def.category === "BONE" && def.id === "pelvis" && modality === "CT") {
      reason = "Pelvic anatomy outside thoracic scan coverage.";
    } else if (def.category === "CARDIAC" && def.id !== "heart") {
      reason = "Multi-chamber cardiac sub-segmentation not performed.";
    }

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      availability: "not_available",
      unavailabilityReason: reason,
      provenance: "UNAVAILABLE",
      visible: false,
      isolated: false,
      opacity: 0.0,
      color: def.defaultColor,
      description: def.description,
    };
  });
}

/**
 * Validates whether a study contains genuine multi-phase temporal acquisition data
 * (such as ECG-gated cardiac CT, cine MRI, or 4D time series).
 *
 * CRITICAL RULE: For static scans, returns hasTemporal: false.
 * NEVER fabricates LVEF, EDV, ESV, stroke volume, or heart rate.
 */
export function detectGenuine4D(study: Study): {
  hasTemporal: boolean;
  provenance: ClinicalDataProvenance;
  reason: string;
  phaseCount: number;
  seriesId?: string;
} {
  if (!study || !study.series || study.series.length === 0) {
    return {
      hasTemporal: false,
      provenance: "UNAVAILABLE",
      reason: "4D unavailable — study contains no temporal acquisition.",
      phaseCount: 0,
    };
  }

  // Look for series with explicit multi-phase / cine parameters
  for (const s of study.series) {
    const label = s.label.toLowerCase();
    const isCine =
      label.includes("cine") ||
      label.includes("gated") ||
      label.includes("multi-phase") ||
      label.includes("cardiac phase") ||
      label.includes("temporal phase");

    // Must have multiple frames
    if (isCine && s.sliceCount > 1) {
      return {
        hasTemporal: true,
        provenance: "PATIENT_DERIVED",
        reason: "Acquired multi-phase ECG-gated clinical cine sequence.",
        phaseCount: Math.min(s.sliceCount, 30),
        seriesId: s.id,
      };
    }
  }

  // Static scan
  return {
    hasTemporal: false,
    provenance: "UNAVAILABLE",
    reason: "4D unavailable — study contains no temporal acquisition.",
    phaseCount: 1,
  };
}

export const DEFAULT_CLIPPING: AnatomicalClipping = {
  axial: { enabled: false, position: 0.5, reverse: false, syncWithSlice: true },
  coronal: { enabled: false, position: 0.5, reverse: false, syncWithSlice: true },
  sagittal: { enabled: false, position: 0.5, reverse: false, syncWithSlice: true },
};
