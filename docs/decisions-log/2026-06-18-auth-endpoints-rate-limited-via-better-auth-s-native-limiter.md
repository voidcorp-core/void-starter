---
date: 2026-06-18
title: "Auth endpoints rate-limited via Better-Auth's native limiter with database storage"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-06-18: Auth endpoints rate-limited via Better-Auth's native limiter with database storage

- **Date:** 2026-06-18
- **Decision:** Brute-force protection for the auth flow is configured on Better-Auth itself, not on `@repo/core/createMemoryRateLimit`. `auth.repository.ts` sets `rateLimit: { storage: 'database', modelName: 'rateLimit', customRules: { ... } }`, backed by a `rate_limits` Postgres table (the `rateLimits` Drizzle schema + migration `0002`). `customRules` tighten the brute-force-prone endpoints (`/sign-in/email`, `/sign-in/magic-link`, `/forget-password`, `/reset-password` to 5/60s; `/sign-up/email` to 10/60s) below Better-Auth's 100/60s global default.
- **Why:** Sign-in, sign-up, magic-link request and password reset are Better-Auth's own HTTP endpoints (`/api/auth/[...all]`), not custom Server Actions, so the natural enforcement point is Better-Auth's built-in limiter, which already wraps every auth route. `@repo/core/createMemoryRateLimit` is the wrong tool here on two counts: it is documented dev/test-only (its `Map` is per-invocation on serverless, so it silently grants every request its own bucket -- no real limit), and it sits at the Server Action layer, which the auth endpoints never traverse. Choosing `storage: 'database'` over Better-Auth's default in-memory store is the same correctness fix: counters must persist across serverless invocations to hold. The starter already ships Postgres, so database storage adds one small table and no new infrastructure -- strictly better than wiring Upstash before an MVP needs it.
- **Rejected alternatives:**
  - _Better-Auth limiter with default in-memory storage_: zero migration, but per-invocation counters on Vercel make it cosmetic -- the exact silent-failure mode the in-memory `@repo/core` limiter warns against.
  - _`@repo/core/createMemoryRateLimit` on a custom action_: teaches the primitive but does not protect the real auth endpoints (they are not custom actions) and inherits the serverless caveat. The memory limiter stays the right tool for genuinely single-process or test paths and for custom actions once Upstash backs it.
  - _`_modules/rate-limit-upstash` from day one_: adds an Upstash dependency and env surface before any MVP has the traffic to need Redis-grade limiting. Database storage on the Postgres the starter already provisions is the lower-cost correct default; swap to Upstash when an MVP's volume justifies it.
- **When to revisit:** If an MVP's auth traffic outgrows Postgres-backed counters (lock contention on the `rate_limits` table under heavy load), move Better-Auth's rate-limit storage to `secondary-storage` backed by Upstash/Redis. If Better-Auth changes its rate-limit model schema, regenerate the migration to match the documented fields (`id`, `key`, `count`, `lastRequest`).
