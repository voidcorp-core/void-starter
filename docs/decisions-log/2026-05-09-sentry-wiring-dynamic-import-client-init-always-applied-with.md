---
date: 2026-05-09
title: "Sentry wiring: dynamic-import client init, always-applied withSentryConfig, app-level @sentry/nextjs dep"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Sentry wiring: dynamic-import client init, always-applied withSentryConfig, app-level @sentry/nextjs dep

- **Date:** 2026-05-09
- **Decision:** Sentry integrates into `apps/web` through three deliberate non-default choices, all interlocking:
  1. **`instrumentation-client.ts` uses a dynamic `import('@repo/sentry/client')` gated on `process.env['NEXT_PUBLIC_SENTRY_DSN']`** rather than a static top-of-file import. The dynamic import resolves only when the public DSN is set at build time.
  2. **`withSentryConfig(config, ...)` is applied unconditionally in `next.config.ts`** with no env-var gate around the wrapper itself. The Sentry runtime still short-circuits at module-init when the DSN is unset; only source-map upload (gated server-side by `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`) varies with env presence.
  3. **`apps/web/package.json` lists `@sentry/nextjs` as a direct dependency**, not just as a transitive of `@repo/sentry`. Both `next.config.ts` (`withSentryConfig` import) and `app/global-error.tsx` (`Sentry.captureException` import) bypass the wrapper.
- **Why:**
  1. _Dynamic import._ Turbopack does not statically tree-shake `process.env['NEXT_PUBLIC_*']` branches across module boundaries; a static `import '@repo/sentry/client'` would always pull the SDK into the eager bundle, ~80KB before activation. The dynamic gate keeps the SDK chunks unreachable from the eagerly loaded entry when the DSN is unset, which is what we actually pay for. Trade-off: the chunks still ship on disk under `.next/static/chunks/` but are never fetched by the user. Documented in `_modules/observability-sentry/README.md` so the contract is explicit.
  2. _Always-applied wrapper._ Gating `withSentryConfig` on env presence creates two divergent build outputs (with and without source-map plugin instrumentation), which is harder to reason about than a single output where the runtime chooses to short-circuit. The wrapper is itself a no-op when its bundler plugin can't find an auth token. Single code path, single mental model.
  3. _Direct app dep._ `next.config.ts` runs in a pre-Next environment where workspace transpilation hasn't kicked in yet, so it cannot import via `@repo/sentry`. Likewise `global-error.tsx` calls `Sentry.captureException` directly to keep the failure path simple. Pinning `@sentry/nextjs` at the app level reflects the actual import graph; relying on a transitive resolution would silently break on a `@repo/sentry` major bump that drops the SDK.
- **Rejected alternatives:**
  - Static client import + runtime `if (key) Sentry.init()`: ships the entire SDK into the eager bundle every build. Defeats the opt-in promise.
  - Conditional `withSentryConfig` (`if (DSN) withSentryConfig(...)`): two build shapes, harder to debug, wrapper is already idempotent.
  - Rely on transitive `@sentry/nextjs` via `@repo/sentry`: hides the actual import graph, breaks if the wrapper drops or major-bumps the SDK.
- **When to revisit:** When Turbopack ships reliable cross-package DCE for `process.env['NEXT_PUBLIC_*']` branches (the dynamic-import workaround can collapse to a static import). When Next or Sentry ship a build-time DSN gate that produces a single output regardless of env (the always-applied wrapper convention can be revisited). When the failure paths in `global-error.tsx` move into `@repo/sentry` (the app-level direct dep can drop).
