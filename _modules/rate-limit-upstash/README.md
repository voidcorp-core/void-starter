# @void/rate-limit-upstash

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for an Upstash Redis adapter implementing the `RateLimiter` interface from `@void/core/rate-limit`. The starter ships an in-memory limiter (correct for tests and single-process dev, but worthless on Vercel serverless where each invocation gets its own `Map`). Activate this module the moment an MVP needs real rate limiting in production.

## Why this module

`packages/core/src/rate-limit.ts` ships `createMemoryRateLimit()` with an explicit warning: it is per-process and silently grants every request its own counter on horizontally-scaled deploys. This is intentional -- the starter cannot bake a vendor coupling into core. Upstash is the 2026 default for HTTP-callable Redis on Vercel because of REST-API compatibility (no TCP, edge-runtime safe), the `@upstash/ratelimit` library implementing sliding window / token bucket / fixed window algorithms out of the box, and a generous free tier (10k requests/day) that matches the starter's profile.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | public | REST endpoint URL of the Upstash Redis database (e.g. `https://eu1-foo-12345.upstash.io`). |
| `UPSTASH_REDIS_REST_TOKEN` | secret | REST API token for the Upstash Redis database. Read-write scope is required for rate limit counters. |

Both are auto-provisioned by the Vercel Marketplace integration when an Upstash Redis is added to a project. No manual copying needed if the integration is used.

## Install (when implementing)

The module wraps `@upstash/ratelimit` to satisfy the `RateLimiter` interface declared in `packages/core/src/rate-limit.ts`. The interface is intentionally narrow (a single `check(key)` returning `{ allowed, remaining, retryAfterMs }`) so a real adapter is a small file.

1. Add the dependencies. Two acceptable shapes:
   - Pattern A (real workspace package): create `packages/rate-limit-upstash/` with its own `package.json`, depending on `@upstash/redis` and `@upstash/ratelimit`. Re-exports `createUpstashRateLimit(config): RateLimiter`.
   - Pattern B (inline): add the two packages to `apps/web/package.json` and write the adapter under `apps/web/src/lib/rate-limit.upstash.ts`. Use this when only one app needs rate limiting.

   ```json
   "dependencies": {
     "@upstash/redis": "^1.34.0",
     "@upstash/ratelimit": "^2.0.0"
   }
   ```

2. Run `bun install` from the repo root.

3. Implement the adapter satisfying the existing `RateLimiter` type:

   ```ts
   import 'server-only';
   import { Ratelimit } from '@upstash/ratelimit';
   import { Redis } from '@upstash/redis';
   import type { RateLimiter, RateLimitConfig } from '@void/core/rate-limit';

   export function createUpstashRateLimit(config: RateLimitConfig): RateLimiter {
     const limiter = new Ratelimit({
       redis: Redis.fromEnv(),
       limiter: Ratelimit.slidingWindow(config.max, `${config.windowMs} ms`),
       analytics: true,
     });

     return {
       check: async (key) => {
         const { success, remaining, reset } = await limiter.limit(key);
         return {
           allowed: success,
           remaining,
           retryAfterMs: Math.max(0, reset - Date.now()),
         };
       },
     };
   }
   ```

4. Swap the limiter at every call site. The starter's call sites import `createMemoryRateLimit` directly (search the codebase for it). Replace those imports with `createUpstashRateLimit` from this module. The `RateLimiter` interface is preserved so no caller needs to change otherwise.

5. Decide on key shape. The `key` argument is opaque to the limiter; standard choices are `ip:<request.ip>` for anonymous endpoints, `user:<userId>` for authenticated mutations, or composite `route:<path>:user:<userId>` for per-route quotas. Document the chosen scheme in `docs/SECURITY.md` so contributors stay consistent.

6. Mount the limiter in `apps/web/src/proxy.ts` for top-level edge gating (per ADR 24, `proxy.ts` is the Next 16 file convention). Keep service-layer `defineAction` rate limits on top for sensitive mutations -- the proxy is broad and the action wrapper is fine-grained.

## Integration points

- `packages/core/src/rate-limit.ts` -- the existing `RateLimiter` interface this module implements
- `apps/web/src/proxy.ts` -- edge-runtime gating via `clerkMiddleware`-style chained limiter or standalone
- `packages/auth/src/auth-action.ts` -- `defineAction` wrapper extension to apply per-action limits
- `apps/web/src/app/api/webhooks/stripe/route.ts` -- webhook endpoint rate limit (per source IP)
- Vercel Marketplace: add Upstash Redis to the project so env vars auto-provision

## Upstream docs

- https://upstash.com/docs/redis -- Upstash Redis overview
- https://upstash.com/docs/oss/sdks/ts/ratelimit/overview -- `@upstash/ratelimit` library docs (sliding window, token bucket, fixed window)
- https://upstash.com/docs/redis/sdks/ts/getstarted -- `@upstash/redis` REST client
- https://vercel.com/marketplace/upstash -- Vercel Marketplace integration

## Removal (after implementing)

The inverse of install. Reverting to the in-memory limiter is acceptable only for dev or tests, never in production.

1. Replace `createUpstashRateLimit` imports with `createMemoryRateLimit` (or remove the limiter call entirely).
2. Drop `@upstash/redis` and `@upstash/ratelimit` from the consuming `package.json`.
3. Delete the adapter file.
4. Unset `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel.
5. Remove the Upstash Redis from the Vercel Marketplace integration if no other module uses it.
6. Run `bun install` to drop the lockfile entries.
