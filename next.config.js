/**
 * Cloudflare builds default to dataset mode; everything else keeps the mock default.
 *
 * `lib/data-source.ts` reads `NEXT_PUBLIC_DATA_MODE` and falls back to "mock",
 * which serves the seeded demo studies from `lib/mock-data.ts`. That fallback is
 * correct for a fresh clone with no dataset, and it is what `.env.local.example`
 * ships. It is wrong for the deployed Worker, and invisibly so:
 *
 *   - `app/(portal)/studies/page.tsx` is a client component, so the value is
 *     inlined into the JS bundle at build time. There is no runtime override.
 *   - `.env.local` (where the real value lives, `NEXT_PUBLIC_DATA_MODE=dataset`)
 *     is gitignored, so the Cloudflare builder never sees it.
 *
 * The result was a green deploy serving mock studies while the R2 dataset mirror
 * sat there unread — the API routes were returning real data that no page asked
 * for.
 *
 * So the default flips on a CI builder only. The builder detection is the same
 * expression `scripts/cf-ensure-open-next.mjs` uses (guard 2 in its header), and
 * for the same reason: WORKERS_CI is what Cloudflare Workers Builds sets, with
 * CF_PAGES and the generic CI accepted as backstops.
 *
 * An explicit value always wins, in both directions — `NEXT_PUBLIC_DATA_MODE=mock`
 * in the dashboard forces the demo data back on without a code change, and a
 * local `npm run build` is untouched because `.env.local` sets the value before
 * this file is evaluated.
 */
const onBuilder = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES || process.env.CI);
const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? (onBuilder ? "dataset" : "mock");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Inlined into the client bundle. Only this one key: SCANLAB_DATA_ROOT and the
  // R2 credentials stay server-side and must never appear here.
  env: {
    NEXT_PUBLIC_DATA_MODE: dataMode,
  },
};

if (onBuilder) {
  console.log(`[next.config] CI builder detected — NEXT_PUBLIC_DATA_MODE=${dataMode}`);
}

module.exports = nextConfig;
