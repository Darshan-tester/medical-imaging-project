/**
 * Shared matching helpers. A dataset's report rows come from a CSV/JSON that
 * an adapter has already loaded; this module never touches the filesystem
 * itself. The contract: given a study's known identifiers (in priority
 * order) and a lookup of "identifier -> report row", return the first row
 * whose key matches ANY of the study's identifiers, trying the strongest
 * (most specific) identifier first. A study with no matching row gets no
 * report — it is never paired with an arbitrary/nearby row.
 */

export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.[a-z0-9.]+$/i, ""); // strip a trailing extension if present
}

export function buildLookup<T>(rows: T[], keyOf: (row: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const norm = normalizeKey(key);
    // First row wins for a given key — never silently overwrite an existing
    // match with a "close enough" duplicate.
    if (!map.has(norm)) map.set(norm, row);
  }
  return map;
}

/** Tries each candidate identifier, strongest first, against the lookup. Returns the first hit, or undefined. */
export function matchByIdentifiers<T>(lookup: Map<string, T>, candidates: (string | undefined)[]): T | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = lookup.get(normalizeKey(candidate));
    if (hit) return hit;
  }
  return undefined;
}
