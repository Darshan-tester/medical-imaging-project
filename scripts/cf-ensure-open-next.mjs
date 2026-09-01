// Guarantees that `.open-next/worker.js` exists before Wrangler deploys.
//
// Wired into wrangler.jsonc as `build.command`. Wrangler 4 always calls
// runCustomBuild(config.build) while resolving the entrypoint — for `deploy`,
// `versions upload` and `dev` alike — and then asserts the entrypoint exists.
// So this runs on every deploy regardless of what the Cloudflare dashboard has
// in its own "Build command" field.
//
// Why it is needed: `next build` produces `.next`, not `.open-next`. Only
// `opennextjs-cloudflare build` produces the Worker bundle. If the dashboard's
// build command is `npm run build`, nothing in the Building phase creates a
// Worker and the deploy fails on a missing entrypoint.
//
// It is deliberately idempotent rather than unconditional, because the same
// deploy can be reached three ways and only one of them needs a build here:
//
//   dashboard build `npm run build`     -> no .open-next -> build now
//   dashboard build `npm run cf:build`  -> .open-next exists -> skip (faster:
//                                          the heavy work stays in the
//                                          Building phase where it belongs)
//   `opennextjs-cloudflare deploy`      -> .open-next exists -> skip
//
// Set OPEN_NEXT_BUILD_COMMAND to override the command — e.g. a Cloudflare
// build variable of `npx opennextjs-cloudflare build --skipNextBuild`, or a
// webpack build if Turbopack ever runs out of memory on the builder.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(repoRoot, ".open-next", "worker.js");
const command = process.env.OPEN_NEXT_BUILD_COMMAND ?? "npx opennextjs-cloudflare build";

if (existsSync(worker)) {
  console.log("[cf-ensure-open-next] .open-next/worker.js already present — skipping the OpenNext build.");
  process.exit(0);
}

console.log(`[cf-ensure-open-next] no .open-next/worker.js — running: ${command}`);

try {
  execSync(command, { cwd: repoRoot, stdio: "inherit" });
} catch (error) {
  // execSync already streamed the real failure to stderr. Re-raising with a
  // vague message on top of it only buries the cause, so keep this short.
  console.error(`[cf-ensure-open-next] "${command}" failed with exit code ${error.status ?? "unknown"}.`);
  process.exit(typeof error.status === "number" && error.status !== 0 ? error.status : 1);
}

if (!existsSync(worker)) {
  console.error(
    `[cf-ensure-open-next] "${command}" reported success but ${worker} still does not exist. ` +
      "Check that open-next.config.ts is present and that wrangler.jsonc's \"main\" still points at .open-next/worker.js.",
  );
  process.exit(1);
}

console.log("[cf-ensure-open-next] .open-next/worker.js is ready.");
