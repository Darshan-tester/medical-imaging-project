import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Throws unless `candidate` resolves to a path inside `root`. Used by every
 * place that turns a manifest-recorded path (or, worse, a browser-supplied
 * one) back into a real filesystem read — the one thing this whole feature
 * must never allow is escaping SCANLAB_DATA_ROOT via `..` segments, symlink
 * tricks, or an absolute path smuggled in through a query/body param.
 */
export function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${candidate}" is outside "${root}"`);
  }
  return resolvedCandidate;
}

/** Deterministic, stable id — same input always produces the same id across re-indexing runs (upsert, never duplicate). */
export function stableId(...parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 16);
}

export interface WalkOptions {
  extensions?: string[]; // lowercase, with leading dot, e.g. [".dcm"]
  maxDepth?: number;
}

/** Recursively lists files under `dir`. Silently skips unreadable subdirectories (permissions, broken links) rather than throwing. */
export function* walk(dir: string, opts: WalkOptions = {}, depth = 0): Generator<string> {
  if (opts.maxDepth !== undefined && depth > opts.maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, opts, depth + 1);
    } else if (entry.isFile()) {
      if (!opts.extensions || opts.extensions.includes(path.extname(entry.name).toLowerCase())) {
        yield full;
      }
    }
  }
}

export function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

export function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function fileStem(p: string): string {
  return path.basename(p, path.extname(p));
}

export function readTextFileSafe(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

/** Minimal dependency-free CSV parser: handles quoted fields with embedded commas/newlines, no external package needed for something this small. */
export function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

/** Case/whitespace/underscore-insensitive column lookup — dataset CSVs are never consistently cased ("Patient ID" vs "patient_id" vs "PatientID"). */
export function pickColumn(row: Record<string, string>, candidates: string[]): string | undefined {
  const normalized = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const target = normalized(candidate);
    const key = keys.find((k) => normalized(k) === target);
    if (key && row[key]) return row[key];
  }
  return undefined;
}
