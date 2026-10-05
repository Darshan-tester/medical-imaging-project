"use client";

import { ViewerAnnotation, ViewerMeasurement, Marker, Finding, ReportSection, Annotation3D } from "./types";

export interface StoredStudySession {
  studyId: string;
  updatedAt: string;
  annotations: ViewerAnnotation[];
  measurements: ViewerMeasurement[];
  markers: Marker[];
  findings: Finding[];
  annotations3D?: Annotation3D[];
  reportSections?: ReportSection;
  acknowledgedCriticalFindings?: string[];
}

const STORAGE_PREFIX = "meridian:session-annotations:";

/**
 * SessionAnnotationStore
 * Provides resilient client-side storage for radiologist annotations, measurements,
 * markers, report drafts, and critical finding acknowledgments.
 * Prevents catastrophic loss of clinical work on browser reload or connection drop.
 */
export const SessionAnnotationStore = {
  save(session: StoredStudySession): void {
    if (typeof window === "undefined") return;
    try {
      const key = `${STORAGE_PREFIX}${session.studyId}`;
      const payload = JSON.stringify({
        ...session,
        updatedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(key, payload);
    } catch (e) {
      console.warn("[SessionAnnotationStore] Failed to save study annotations to localStorage:", e);
    }
  },

  load(studyId: string): StoredStudySession | null {
    if (typeof window === "undefined") return null;
    try {
      const key = `${STORAGE_PREFIX}${studyId}`;
      const data = window.localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data) as StoredStudySession;
    } catch (e) {
      console.warn("[SessionAnnotationStore] Failed to parse stored study annotations:", e);
      return null;
    }
  },

  clear(studyId: string): void {
    if (typeof window === "undefined") return;
    try {
      const key = `${STORAGE_PREFIX}${studyId}`;
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },

  hasSavedWork(studyId: string): boolean {
    if (typeof window === "undefined") return false;
    const key = `${STORAGE_PREFIX}${studyId}`;
    return !!window.localStorage.getItem(key);
  },
};
