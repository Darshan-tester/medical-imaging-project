/**
 * Loads `.env.local` into `process.env`. Import this **first**, for its side
 * effect only:
 *
 *     import "./load-env-local";
 *
 * Why a side-effect import rather than a function call in `main()`: several
 * settings are read at module *load* time, not at call time —
 * `lib/dataset/image-render.ts` resolves `SCANLAB_RENDER_CACHE_MB`,
 * `SCANLAB_VOLUME_MAX_EDGE`, `SCANLAB_VOLUME3D_MAX_EDGE` and the NIfTI window
 * percentiles into module constants via `envInt`. A loader that runs inside
 * `main()` is already too late for those: the render would silently use the
 * built-in defaults while `.env.local` said otherwise. Imports are evaluated in
 * declaration order, so being first is what makes this work.
 *
 * That makes the position of this import load-bearing. Keep it above the
 * `../lib/...` imports; do not let an "organize imports" pass sort it down.
 *
 * `scripts/dataset-index.ts`, `scripts/demo-pack.ts` and `scripts/mpr-check.ts`
 * each carry their own byte-identical copy of this logic, called at the top of
 * their `main()`. They are correct as written — none of them imports
 * `image-render` at load time — so they are deliberately left alone rather than
 * refactored as a side quest. If one of them ever needs the render module, move
 * it to this import instead of relying on its in-`main()` call.
 *
 * Next.js loads `.env.local` on its own for `dev`/`build`; this only exists
 * because these scripts run outside that process.
 */
import fs from "fs";
import path from "path";

let loaded = false;

/**
 * Parses `.env.local` if it exists. A missing file is not an error — the
 * variables may already be exported in the shell, and the caller reports the
 * one it actually needs (`getDataRoot()` throws by name).
 *
 * A non-empty `process.env` value always wins, so `SCANLAB_DATA_ROOT=... npm run
 * mirror:render` overrides the file for one run.
 *
 * An *empty* one does not, and that distinction is not pedantry. PowerShell 5.1
 * keeps `$env:SCANLAB_DATA_ROOT=""` as a defined variable whose value is the
 * empty string, npm hands it to the child, and a `key in process.env` test then
 * treats the shell as authoritative and skips the file. The run dies with
 * "SCANLAB_DATA_ROOT is not set" while `.env.local` sits there plainly setting
 * it, which reads as this loader being broken. An empty string is never a usable
 * path, so it counts as absent.
 */
export function loadEnvLocal(): void {
  if (loaded) return;
  loaded = true;

  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();
