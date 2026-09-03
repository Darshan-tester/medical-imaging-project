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
const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? "demo";

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
