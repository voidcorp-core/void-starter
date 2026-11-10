---
date: 2026-07-24
title: "Prune unselected capabilities and materialize Clerk directly"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Prune unselected capabilities and materialize Clerk directly

- **Date:** 2026-07-24
- **Decision:** Local generation composes the application dependency graph as well as its
  surfaces. A public minimal web output removes Better Auth, Neon/Drizzle, the notes reference
  domain, PostHog, Sentry and every corresponding app import. Better Auth retains the proven
  database-backed baseline. Clerk generates direct Next.js v7 provider, middleware, route and UI
  overlays while removing both `packages/auth` and the `_modules/auth-clerk` documentation
  scaffold. Mobile-only output removes all Next.js-only packages. Generated `.env.example`,
  `package.json`, `next.config.ts`, layout and entry pages are deterministic receipt-tracked
  overlays. `doctor` verifies that local packages and dependencies match the manifest.
- **Why:** Removing a workspace directory without removing its imports produces a repo that looks
  smaller but cannot install, type-check or build. Keeping every optional module avoids that
  failure but defeats the factory's purpose. Treating the package graph, app call sites and config
  as one composition unit makes absence real and testable. The Clerk scaffold explicitly was not
  a runtime drop-in, so copying it would misrepresent support; generating the complete direct
  integration is the honest boundary.
- **Rejected alternatives:**
  - Only remove package dependencies: leaves broken TypeScript imports and routes.
  - Keep all `_modules` directories as examples: generated projects carry unselected catalogue
    code and Knip/build surface.
  - Copy the Clerk repository scaffold over Better Auth: the scaffold does not include provider,
    middleware, UI and session-model changes and documents itself as incomplete.
  - Allow web-only adapters on mobile manifests: implies a native integration that is not
    implemented.
- **When to revisit:** Add native-specific auth, analytics and error adapters behind separate
  manifest adapter names. Move R2, Resend and DNS from planned bindings to materialized
  capabilities only when their idempotent provider `apply` adapters and smoke tests exist.
