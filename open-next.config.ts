import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext (Cloudflare) build configuration.
 *
 * Intentionally minimal. The optional R2 incremental cache and D1 tag cache are
 * left off because they require bindings that do not exist on this account yet,
 * and a missing binding fails the build rather than degrading. This app is
 * `dynamic = "force-dynamic"` on every API route and has no ISR pages, so there
 * is nothing for an incremental cache to hold today.
 */
export default defineCloudflareConfig();
