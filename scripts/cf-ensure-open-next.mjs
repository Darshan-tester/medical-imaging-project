// Guarantees that `.open-next/` exists before Cloudflare tries to deploy.
//
// Why this script exists at all
// -----------------------------
// `next build` produces `.next`. Only `opennextjs-cloudflare build` produces
// the Worker bundle in `.open-next`. If the Cloudflare dashboard's build
// command is `npm run build`, the Building phase never creates a Worker.
//
// And the Deploying phase will not create one either. `wrangler deploy`
// delegates to the adapter before it ever looks at the entrypoint:
//
//   wrangler/wrangler-dist/cli.js:407779  runDeployCommandHandler
//     if (... && await maybeDelegateToOpenNextDeployCommand(process.cwd())) return;
//
// `isOpenNextProject()` is true for this repo (a `next.config.js`, an
// `open-next.config.ts`, and `@opennextjs/cloudflare` installed), so wrangler
// shells out to `npx opennextjs-cloudflare deploy` and returns. That command
// does *not* build — its first real statement is `retrieveCompiledConfig()`,
// which exits 1 with "Could not find compiled Open Next config, did you run
// the build command?" when `.open-next/.build/open-next.config.edge.mjs` is
// missing. Everything after the delegation, including wrangler's own
// `build.command` hook, is skipped.
//
// So the bundle has to exist by the end of the Building phase. This script is
// wired into `postbuild`, which npm runs after `npm run build`.
//
// Wiring
// ------
//   package.json  "postbuild": "node scripts/cf-ensure-open-next.mjs --if-ci"
//   wrangler.jsonc  build.command (backstop for `wrangler dev` and for
//                   `deploy --config`/`--no-autoconfig`, which skip the
//                   delegation and do reach the hook)
//
// Guards, in order of evaluation
// ------------------------------
//  1. Already inside an OpenNext build. `opennextjs-cloudflare build` calls
//     `setStandaloneBuildMode()` (which sets NEXT_PRIVATE_STANDALONE=true)
//     immediately before `buildNextjsApp()` runs `npm run build` — so our own
//     postbuild fires again inside it. Without this guard that recurses
//     forever. `.open-next/worker.js` does not yet exist at that moment, so
//     the existence check in guard 4 cannot catch it.
//  2. `--if-ci` and not on a CI builder. Keeps `npm run build` on the
//     user's Windows box exactly as it was: the adapter build OOMs there
//     (Rust/Turbopack, exit 0xC0000409) and, worse, wipes the good `.next`
//     output on its way down.
//  3. Explicit opt-out, CF_ENSURE_OPEN_NEXT=0.
//  4. Bundle already present — nothing to do. Makes a dashboard build command
//     of `npm run cf:build` cost nothing extra.
//
// Escape hatches: CF_ENSURE_OPEN_NEXT=1 forces it to run anywhere;
// OPEN_NEXT_BUILD_COMMAND replaces the command (e.g. a webpack build, or
// `npx opennextjs-cloudflare build --skipNextBuild`).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(repoRoot, ".open-next", "worker.js");
const command = process.env.OPEN_NEXT_BUILD_COMMAND ?? "npx opennextjs-cloudflare build";
const ifCi = process.argv.includes("--if-ci");
const force = process.env.CF_ENSURE_OPEN_NEXT === "1";
const tag = "[cf-ensure-open-next]";

const skip = (reason) => {
  console.log(`${tag} ${reason}`);
  process.exit(0);
};

// 1. This is the inner `npm run build` of an adapter build that is already
//    running.
if (process.env.CF_ENSURE_OPEN_NEXT_RUNNING === "1" || process.env.NEXT_PRIVATE_STANDALONE === "true") {
  skip("already inside an OpenNext build — skipping (this is the inner `next build`).");
}

// 2. Cloudflare's builder sets WORKERS_CI — that is the variable `ci-info`
//    (bundled into wrangler) uses to identify Workers Builds, and wrangler
//    reads WORKERS_CI_BRANCH alongside it. CF_PAGES and the generic CI are
//    accepted too: a false positive costs one extra build, a false negative
//    costs a failed deploy.
const onBuilder = process.env.WORKERS_CI || process.env.CF_PAGES || process.env.CI;
if (ifCi && !force && !onBuilder) {
  skip("not running on a CI builder (no WORKERS_CI / CF_PAGES / CI) — skipping. Set CF_ENSURE_OPEN_NEXT=1 to force.");
}

// 3.
if (process.env.CF_ENSURE_OPEN_NEXT === "0") {
  skip("CF_ENSURE_OPEN_NEXT=0 — skipping.");
}

// 4.
if (existsSync(worker)) {
  skip(".open-next/worker.js already present — skipping the OpenNext build.");
}

console.log(`${tag} no .open-next/worker.js — running: ${command}`);

try {
  execSync(command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, CF_ENSURE_OPEN_NEXT_RUNNING: "1" },
  });
} catch (error) {
  // execSync already streamed the real failure to stderr. Re-raising with a
  // vague message on top of it only buries the cause, so keep this short.
  console.error(`${tag} "${command}" failed with exit code ${error.status ?? "unknown"}.`);
  process.exit(typeof error.status === "number" && error.status !== 0 ? error.status : 1);
}

if (!existsSync(worker)) {
  console.error(
    `${tag} "${command}" reported success but ${worker} still does not exist. ` +
      'Check that open-next.config.ts is present and that wrangler.jsonc\'s "main" still points at .open-next/worker.js.',
  );
  process.exit(1);
}

console.log(`${tag} .open-next/worker.js is ready.`);
