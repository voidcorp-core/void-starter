---
date: 2026-05-09
title: "postgres-js as the Drizzle Postgres driver"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: postgres-js as the Drizzle Postgres driver

- **Date:** 2026-05-09
- **Decision:** `@repo/db` ships `postgres@^3.4.0` (postgres-js by Porsager) as the underlying Postgres driver, consumed by Drizzle's `drizzle-orm/postgres-js` adapter. node-postgres (`pg`) is not installed.
- **Why:** postgres-js is the recommended driver for Drizzle + Neon serverless setups in 2026. It is ESM-native (no CJS interop quirks under Next 16), has zero runtime deps, and exposes a tagged-template API that maps cleanly to Drizzle's prepared-statement pipeline. node-postgres (`pg`) requires `pg-types` plus a connection pool wrapper, drags two CJS packages into the bundle, and offers no advantage on the Neon pooled endpoint where pool sizing is server-side. Folpe's "fewer deps when quality is not at stake" principle (see ADR 05) tips the balance to postgres-js.
- **Rejected alternatives:**
  - **node-postgres (`pg`):** mature, ubiquitous, but CJS-first and pulls `pg-types` plus a separate pool wrapper. No tangible benefit over postgres-js on Neon, more dependencies, weaker ESM story under Turbopack.
  - **`@neondatabase/serverless`:** Neon's HTTP driver. Faster cold starts on Neon Edge Functions but ties the starter to Neon's HTTP wire format; if `_modules/db-self-hosted-postgres` activates (per ADR 11), the driver swap becomes a code change rather than a connection-string change. Keep the Postgres-wire driver so the migration path stays connection-string-only.
  - **Bun's native `Bun.sql`:** experimental in 2026, no Drizzle adapter parity yet. Revisit when stable and Drizzle ships a first-class adapter.
- **When to revisit:** When Drizzle officially recommends a different driver as the default for Neon, or when Bun's native SQL driver matures and Drizzle ships a `drizzle-orm/bun-sql` adapter. The migration path is a one-line dep swap plus a one-line adapter import.
