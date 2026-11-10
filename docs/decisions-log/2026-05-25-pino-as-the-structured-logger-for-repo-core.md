---
date: 2026-05-25
title: "pino as the structured logger for `@repo/core`"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: pino as the structured logger for `@repo/core`

- **Date:** 2026-05-09
- **Decision:** `@repo/core/logger` ships `pino` (Node) plus `pino-pretty` as a dev-only transport. The same `logger` is used across all server-side code: Server Actions, route handlers, the Better-Auth `sendMagicLink` stub, and Drizzle query logs (when enabled). Production emits raw JSON; dev emits colorized lines via `pino-pretty`.
- **Why:** pino is the industry-standard JSON-first server logger for Node — fastest in benchmarks, mature transport ecosystem (Datadog, Loki, ELK), structured-by-default with first-class `child()` loggers for per-request context. Vercel Functions' log pipeline ingests pino's JSON natively. The `pino-pretty` transport stays gated behind `NODE_ENV !== 'production'`, so production deploys never load the worker_threads-based transport.
- **Rejected alternatives:**
  - **consola (Nuxt):** excellent DX in dev, smaller bundle, but weaker integration with prod log pipelines (not JSON-first; field shapes vary). Better suited for CLIs and Nitro apps; we run on Vercel Functions where structured JSON is the gold standard. Worth re-evaluating only if we ever ship a CLI inside this monorepo.
  - **winston:** older, more configurable, slower. No clear advantage in 2026; pino has overtaken it on every dimension that matters here.
  - **OpenTelemetry directly:** complementary, not a replacement. We can layer OTel exporters on top of pino transports later (Phase D candidate); choosing pino does not foreclose adding OTel.
  - **`console.log`:** zero structure, no log levels, no fields, no transports. Useless at scale and noisy in test output.
- **When to revisit:** When deploying to Edge runtimes that lack `worker_threads` (`pino-pretty`'s transport requires it). The fix is to drop `pino-pretty` even in dev and stay on raw JSON, or swap to consola for the dev-only path. Already mitigated because `pino-pretty` only loads when `NODE_ENV !== 'production'`, but adding an Edge-targeted route would force the issue.
