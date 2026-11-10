---
date: 2026-05-09
title: "PostHog EU reverse proxy under /ingest and skipTrailingSlashRedirect"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: PostHog EU reverse proxy under /ingest and skipTrailingSlashRedirect

- **Date:** 2026-05-09
- **Decision:** `apps/web/next.config.ts` ships three `rewrites()` rules under `/ingest/static/*`, `/ingest/array/*`, and `/ingest/*` that reverse-proxy PostHog's EU endpoints, plus `skipTrailingSlashRedirect: true` at the config level. PostHog's `NEXT_PUBLIC_POSTHOG_HOST` defaults to `/ingest` so the SDK posts to the deploy origin.
- **Why:** Three problems collapse into one solution: ad-blockers (uBlock, Brave, AdGuard) drop direct requests to `*.posthog.com`; CSP `connect-src` rules in tight policies must whitelist every third-party origin; and ePrivacy / RGPD positioning is cleaner when analytics traffic never leaves the deploy origin. Reverse-proxying through `/ingest` solves all three at once and matches PostHog's official 2026 recommendation. The `skipTrailingSlashRedirect: true` flag is mandatory: without it, Next.js 16 issues a 308 redirect from `/ingest/...` to `/ingest/.../` BEFORE the rewrite fires, which breaks the proxy. The flag has app-wide effect (no trailing-slash redirects on any route), which is acceptable because the starter never relies on Next.js's default trailing-slash normalization.
- **Rejected alternatives:**
  - Direct PostHog endpoint (`https://eu.i.posthog.com`): blocked by ad-blockers, requires CSP `connect-src` whitelist, leaks third-party traffic.
  - Cloudflare-style external proxy: extra moving piece, doesn't solve CSP automatically, adds a hop.
  - Rewrites without `skipTrailingSlashRedirect`: 308 hijack breaks the JS array endpoint and the capture endpoint silently. Took half a debug cycle the first time; the flag must be set, and the trade-off (no trailing-slash redirects) is documented here so future contributors don't drop it.
  - Disable trailing-slash handling per route: not supported by Next.js — it's a global config flag.
- **When to revisit:** If the app starts relying on Next.js's default trailing-slash redirect for SEO or canonical-URL reasons (it currently doesn't). If PostHog ships an official Next.js plugin that handles the proxy without the trailing-slash quirk. If a different analytics vendor replaces PostHog and the proxy convention no longer applies.
