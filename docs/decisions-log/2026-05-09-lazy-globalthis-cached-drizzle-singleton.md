---
date: 2026-05-09
title: "Lazy globalThis-cached Drizzle singleton"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Lazy globalThis-cached Drizzle singleton

- **Date:** 2026-05-08
- **Decision:** `@repo/db/client` exposes a single `getDb(): Database` function. The postgres-js pool and Drizzle instance are constructed on first call, memoized in a module-local slot for the lifetime of the process, and additionally stashed on `globalThis` in non-production so Next.js HMR-reloaded modules reuse the same pool. No `{ max }` is set on postgres-js.
- **Why:** Eager pool construction at module load leaks a fresh connection on every Next.js dev hot-reload and forces every importer (knip, tsc, biome, build-time scripts) to have `DATABASE_URL` set just to load the module. Lazy + memoized + globalThis-cached avoids both, while keeping a single per-process pool in production. The Neon pooled endpoint manages connection limits server-side, so a hand-tuned `{ max }` is cargo-culted noise.
- **Rejected alternatives:**
  - Eager pool construction at module load: leaks connections on Next.js hot reload and forces env validation at import time, breaking type-check / knip / biome on any package that transitively imports `@repo/db/client`.
  - Eager env validation + lazy pool: would catch `DATABASE_URL` typos at module load. Rejected because static analyzers (knip, tsc, biome) import `@repo/db/client` without `DATABASE_URL` set, and Zod URL validation at module load would break those workflows the same way eager pool construction did.
  - `Proxy`-wrapped `db: Database` const: the Proxy hop fires on every property read, breaks `instanceof` / type narrowing / devtools display, and adds zero capability over a function call. No 2026 reference (Vercel, Drizzle docs, Neon docs, next-forge, t3-stack) prescribes it.
  - Replacing `createAppEnv` with `required()` inside the client: loses Zod URL validation that catches `localhost` typos and missing `postgres://` schemes.
- **When to revisit:** If we ship a non-Vercel deploy target without a Neon-style server-side pooler, reconsider postgres-js options (explicit `{ max }`, `idle_timeout`). If a future Drizzle release ships a first-party request-scoped client, evaluate replacing the Node singleton with it.
- **Last revised:** 2026-09-02 (DEV-770). This revises the client's test, not the singleton. `client.test.ts` imported the module dynamically in every case so the lazy `cached` slot starts empty, which made the first case also pay the cold `drizzle-orm/postgres-js` graph inside Vitest's 5 s per-case clock: 1291 to 1349 ms under the root Turborepo fan-out at load average 6 to 29, 5117 to 6376 ms at load average 25 to 42, so the root gate failed on a green tree. The export-shape case now asserts on a static top-level import, which pays that graph at file load, the phase Vitest leaves unbounded, and the fresh-module case proves its fresh instance by identity against the static namespace instead of assuming it from `vi.resetModules()`. Rejected: raising the case timeout (hides the cost, DEV-767 precedent) and a bounded `beforeAll` warm-up (three times the measured worst case already exceeds the 10 s hook default, so the bound would only relocate the flake).
