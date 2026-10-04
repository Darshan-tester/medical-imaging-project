"use client";

import { Patient3DAnatomyViewer, Patient3DAnatomyViewerProps } from "./Patient3DAnatomyViewer";

/**
 * Volume3DViewer canonical export.
 * Delegates directly to Patient3DAnatomyViewer, guaranteeing that all
 * 3D viewports across Meridian render patient-specific anatomy derived
 * from the actual CT/MRI volume and TotalSegmentator segmentations.
 */
export function Volume3DViewer(props: Patient3DAnatomyViewerProps) {
  return <Patient3DAnatomyViewer {...props} />;
}
