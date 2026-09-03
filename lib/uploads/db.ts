/**
 * ---------------------------------------------------------------------------
 * UPLOAD STORE
 * ---------------------------------------------------------------------------
 * Where an uploaded study lives. Two things have to persist: the record (a few
 * kilobytes of JSON) and the original bytes of every file (megabytes to
 * hundreds of megabytes), and they have to survive a page reload — otherwise
 * refreshing `/studies/upl_…` would find nothing and the viewer would fall back
 * to "Study not found", which is exactly the failure this replaces.
 *
 * IndexedDB is the only option that fits. The deployed target is a Cloudflare
 * Worker: there is no filesystem to write to, no guaranteed R2 or KV binding,
 * and no server-side session — and `localStorage` is both string-only and
 * quota-limited to a few megabytes, which a single CT series exceeds. So the
 * store is the browser's, the bytes never leave the machine, and nothing about
 * an upload is sent anywhere.
 *
 * When IndexedDB is unavailable (private windows, storage blocked, SSR) the
 * upload still works for the current page session out of an in-memory map, and
 * the record is marked `storage: "session"` so the UI can say so rather than
 * letting a later reload look like data loss.
 * ---------------------------------------------------------------------------
 */

import { UploadedStudyRecord, UPLOAD_RECORD_VERSION } from "./types";

const DB_NAME = "meridian-uploads";
const DB_VERSION = 1;
const STORE_STUDIES = "studies";
const STORE_BLOBS = "blobs";

/**
 * Ceiling on one upload, checked before anything is written.
 *
 * Not a browser limit — IndexedDB will usually take more — but a full-body CT
 * dropped in by accident is gigabytes, and a write that large blocks the tab
 * for minutes with no way to cancel. Refusing with a number in the message is
 * more useful than appearing to hang.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadBlobInput {
  blobId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  name: string;
}

interface StoredBlob {
  key: string;
  studyId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  name: string;
}

const blobKey = (studyId: string, blobId: string) => `${studyId}/${blobId}`;

/*
 * Session fallback. Records are always kept here as well — they are small, and
 * it saves a database round trip on the navigation that immediately follows an
 * upload. Bytes are only held when IndexedDB could not take them, because
 * keeping a second copy of a 300 MB series in memory for no reason is how a tab
 * runs out of it.
 */
const memoryRecords = new Map<string, UploadedStudyRecord>();
const memoryBlobs = new Map<string, StoredBlob>();

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!indexedDbAvailable()) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STUDIES)) db.createObjectStore(STORE_STUDIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Writes the record and all of its bytes in one transaction.
 *
 * One transaction on purpose: a study whose record exists but whose pixels do
 * not would open in the viewer and then fail to render every slice. Either both
 * land or neither does.
 */
export async function putUpload(record: UploadedStudyRecord, blobs: UploadBlobInput[]): Promise<UploadedStudyRecord> {
  const total = blobs.reduce((sum, b) => sum + b.bytes.byteLength, 0);
  if (total > MAX_UPLOAD_BYTES) {
    throw new Error(
      `This upload is ${(total / 1024 / 1024).toFixed(0)} MB, over the ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit for a single study.`,
    );
  }

  if (indexedDbAvailable()) {
    try {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_STUDIES, STORE_BLOBS], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
          tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write was aborted"));

          tx.objectStore(STORE_STUDIES).put({ ...record, storage: "persistent" });
          const store = tx.objectStore(STORE_BLOBS);
          for (const b of blobs) {
            store.put({ key: blobKey(record.id, b.blobId), studyId: record.id, bytes: b.bytes, mimeType: b.mimeType, name: b.name });
          }
        });
      } finally {
        db.close();
      }

      const persisted: UploadedStudyRecord = { ...record, storage: "persistent" };
      memoryRecords.set(persisted.id, persisted);
      return persisted;
    } catch {
      /* Falls through to the session store — quota, private mode, or a blocked upgrade. */
    }
  }

  const session: UploadedStudyRecord = { ...record, storage: "session" };
  memoryRecords.set(session.id, session);
  for (const b of blobs) {
    memoryBlobs.set(blobKey(session.id, b.blobId), {
      key: blobKey(session.id, b.blobId),
      studyId: session.id,
      bytes: b.bytes,
      mimeType: b.mimeType,
      name: b.name,
    });
  }
  return session;
}

function usable(record: UploadedStudyRecord | undefined): UploadedStudyRecord | undefined {
  // A record written by a different build of this module is ignored rather than
  // read with fields that may have moved.
  return record && record.version === UPLOAD_RECORD_VERSION ? record : undefined;
}

export async function getUploadRecord(id: string): Promise<UploadedStudyRecord | undefined> {
  const cached = usable(memoryRecords.get(id));
  if (cached) return cached;

  if (!indexedDbAvailable()) return undefined;
  try {
    const db = await openDb();
    try {
      const found = usable(
        await runRequest<UploadedStudyRecord | undefined>(db.transaction(STORE_STUDIES, "readonly").objectStore(STORE_STUDIES).get(id)),
      );
      if (found) memoryRecords.set(id, found);
      return found;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** Every stored upload, newest first. Never throws: the studies list must render without them. */
export async function listUploadRecords(): Promise<UploadedStudyRecord[]> {
  const byId = new Map<string, UploadedStudyRecord>();

  if (indexedDbAvailable()) {
    try {
      const db = await openDb();
      try {
        const all = await runRequest<UploadedStudyRecord[]>(db.transaction(STORE_STUDIES, "readonly").objectStore(STORE_STUDIES).getAll());
        for (const r of all) {
          const ok = usable(r);
          if (ok) byId.set(ok.id, ok);
        }
      } finally {
        db.close();
      }
    } catch {
      /* Session-only, then. */
    }
  }

  for (const r of memoryRecords.values()) {
    const ok = usable(r);
    if (ok) byId.set(ok.id, ok);
  }

  return [...byId.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function getUploadBytes(studyId: string, blobId: string): Promise<{ bytes: ArrayBuffer; mimeType: string } | undefined> {
  const key = blobKey(studyId, blobId);

  const inMemory = memoryBlobs.get(key);
  if (inMemory) return { bytes: inMemory.bytes, mimeType: inMemory.mimeType };

  if (!indexedDbAvailable()) return undefined;
  try {
    const db = await openDb();
    try {
      const found = await runRequest<StoredBlob | undefined>(db.transaction(STORE_BLOBS, "readonly").objectStore(STORE_BLOBS).get(key));
      return found ? { bytes: found.bytes, mimeType: found.mimeType } : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
