import path from "path";

/**
 * Validates that an identifier (studyId, seriesId, jobId, meshName, segName)
 * contains only safe alphanumeric, dash, underscore, and dot characters,
 * and contains NO path traversal sequences (e.g., .., /, \).
 */
export function isValidIdentifier(id?: string | null): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length === 0 || id.length > 256) return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\")) return false;
  return /^[a-zA-Z0-9_\-\.]+$/.test(id);
}

/**
 * Sanitizes an identifier by taking its basename and replacing non-permitted characters.
 */
export function sanitizeIdentifier(id: string): string {
  const base = path.basename(id);
  return base.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

/**
 * Validates that a target file path resolves strictly within the authorized parent directory.
 */
export function isPathInside(childPath: string, parentDir: string): boolean {
  const resolvedChild = path.resolve(childPath);
  const resolvedParent = path.resolve(parentDir);
  const relative = path.relative(resolvedParent, resolvedChild);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Safely extracts and parses JSON from Python subprocess stdout, ignoring any log banners.
 */
export function parsePythonJson<T = any>(stdout: string): T {
  const trimmed = stdout.trim();
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  let startIdx = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  const lastBrace = trimmed.lastIndexOf("}");
  const lastBracket = trimmed.lastIndexOf("]");
  const endIdx = Math.max(lastBrace, lastBracket);

  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    return JSON.parse(trimmed.slice(startIdx, endIdx + 1));
  }
  return JSON.parse(trimmed);
}
