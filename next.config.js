/**
 * Where the UI gets its studies from, decided at build time.
 *
 * `NEXT_PUBLIC_DATA_MODE` is read by `lib/data-source.ts` and inlined into the
 * client bundle by Next, because `app/(portal)/studies/page.tsx` is a client
 * component. There is no runtime override, which is what made the previous
 * default fail invisibly:
 *
 *   - the fallback was `mock`, so a fresh clone and the deployed Worker both
 *     served the invented MRD-* studies from `lib/mock-data.ts`;
 *   - the CI builder was flipped to `dataset`, whose pixels come from API routes
 *     that read DICOM and NIfTI off disk through `SCANLAB_DATA_ROOT` — a path the
 *     Cloudflare Worker does not have. Those routes had nothing to read, so the
 *     deploy fell back to mock data anyway.
 *
 * The default is now `demo`: the real CT / MRI / PET / X-ray studies committed
 * under `public/demo-data`, indexed by `npm run demo:index` into
 * `public/demo-data/index.json`. They are static assets, so this is the only mode
 * that works on the Worker, and it works identically in local dev.
 *
 * An explicit value still wins, in both directions. `NEXT_PUBLIC_DATA_MODE=dataset`
 * in `.env.local` gives the full local corpus through the manifest and the API
 * routes; `=mock` restores the seeded placeholder studies the component tests and
 * the design-time pages rely on.
 */
const requestedMode = process.env.NEXT_PUBLIC_DATA_MODE;

/**
 * Cloudflare's builder, specifically — not CI in general.
 *
 * `WORKERS_CI` is set by Workers Builds and `CF_PAGES` by Pages. Bare `CI` is
 * deliberately *not* consulted: this repo's own `.env.local` sets
 * `NEXT_PUBLIC_DATA_MODE=dataset`, which is correct on the machine that holds
 * ScanLab_Datasets, and a stray `CI=true` in someone's shell must not quietly
 * downgrade that build.
 */
const isCloudflareBuild = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES);

/**
 * Set to `1` in the Cloudflare build variables once `mirror:export`,
 * `mirror:render` and `mirror:upload` have actually populated the `DATASET` R2
 * bucket. Until then `dataset` mode has nothing to read on the Worker, and
 * whether the bucket is populated is not knowable from here at build time.
 */
const mirrorPopulated = process.env.CF_DATASET_MIRROR === "1";

let dataMode = requestedMode ?? "demo";

/*
 * A leftover `NEXT_PUBLIC_DATA_MODE=dataset` build variable in the Cloudflare
 * dashboard survived the default change above and shipped an empty deploy: the
 * Studies page rendered `IndexStatusBanner` ("No dataset index has been built
 * yet"), the modality filters showed "0 studies", and the Upload page reported
 * every file unmatched — over a repository that had 18 real studies committed
 * under `public/demo-data`. Nothing was broken; the build was simply pointed at
 * a manifest and a data root that a Worker cannot have.
 *
 * So on a Cloudflare build, `dataset` is honoured only with the explicit mirror
 * opt-in above. Otherwise fall back to `demo`, which is real committed data —
 * a smaller corpus than the mirror, never mock studies — and say so in the
 * build log, since that log is the only place this decision is visible.
 */
if (isCloudflareBuild && dataMode === "dataset" && !mirrorPopulated) {
  dataMode = "demo";
  console.log(
    "[next.config] NEXT_PUBLIC_DATA_MODE=dataset ignored on the Cloudflare build: " +
      "a Worker has no SCANLAB_DATA_ROOT, and CF_DATASET_MIRROR=1 is not set, so the " +
      "R2 mirror cannot be assumed populated. Falling back to demo (public/demo-data)."
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Inlined into the client bundle. Only this one key: SCANLAB_DATA_ROOT and the
  // R2 credentials stay server-side and must never appear here.
  env: {
    NEXT_PUBLIC_DATA_MODE: dataMode,
  },
};

console.log(`[next.config] NEXT_PUBLIC_DATA_MODE=${dataMode}`);

module.exports = nextConfig;
