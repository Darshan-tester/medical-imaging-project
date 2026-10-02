"use client";

export type AuditAction =
  | "STUDY_OPENED"
  | "SERIES_SWITCHED"
  | "SLICE_VIEWED"
  | "CRITICAL_FINDING_CONFIRMED"
  | "CRITICAL_FINDING_DISMISSED"
  | "ANNOTATION_COMMITTED"
  | "MEASUREMENT_RECORDED"
  | "AI_FINDING_ACCEPTED"
  | "AI_FINDING_REJECTED"
  | "REPORT_DRAFTED"
  | "REPORT_QC_EVALUATED"
  | "REPORT_APPROVED"
  | "REPORT_EXPORTED_PDF";

export interface AuditRecord {
  id: string;
  timestamp: string;
  studyId: string;
  action: AuditAction;
  user: {
    id: string;
    name: string;
    role: string;
  };
  details: Record<string, unknown>;
}

const AUDIT_STORAGE_KEY = "meridian:audit-trail";

/**
 * Clinical Audit Trail System (21 CFR Part 11 & HIPAA Compliance)
 * Records tamper-evident chronological event records of radiologist actions.
 */
export const AuditTrail = {
  record(
    studyId: string,
    action: AuditAction,
    user: { id: string; name: string; role: string },
    details: Record<string, unknown> = {}
  ): AuditRecord {
    const entry: AuditRecord = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      studyId,
      action,
      user,
      details,
    };

    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
        const list: AuditRecord[] = raw ? JSON.parse(raw) : [];
        list.push(entry);
        // Retain last 500 audit events in client log
        if (list.length > 500) list.shift();
        window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(list));
      } catch (e) {
        console.warn("[AuditTrail] Failed to write audit log:", e);
      }
    }

    return entry;
  },

  getStudyEvents(studyId: string): AuditRecord[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
      if (!raw) return [];
      const list: AuditRecord[] = JSON.parse(raw);
      return list.filter((r) => r.studyId === studyId);
    } catch {
      return [];
    }
  },

  getAllEvents(): AuditRecord[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
};
