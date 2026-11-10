---
date: 2026-05-09
title: "Placeholder modules are README-only and stay out of the workspace graph"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Placeholder modules are README-only and stay out of the workspace graph

- **Date:** 2026-05-09
- **Decision:** `_modules/*` placeholders (Stripe, Resend, Payload CMS, Audit-log, Cookie-consent, Upstash rate-limit, i18n, self-hosted Postgres) ship a README.md only. No `package.json`, no `src/`, no `tsconfig.json`. They do not appear in `bun install`'s workspace resolution, in Turborepo's task graph, in knip's project map, or in the type-checker's program. Real workspace packages (`@repo/sentry`, `@repo/posthog`, `@repo/auth-clerk`) ship the full structure and are part of the graph.
- **Why:** A placeholder with an empty `package.json` would pollute every cross-cutting tool: knip would report unused workspace deps, Turborepo would schedule no-op `lint` / `type-check` / `test` / `build` tasks for each, Renovate would open dependency PRs against scaffolds nobody is using yet, and `bun install` would link 8+ phantom packages. The cost is real and recurring; the benefit (the package "exists" in `bun pm ls`) is illusory because the integration code lives only as a README recipe. Pattern B (per `_modules/README.md`) is "the recipe IS the artifact": when an MVP needs the capability, a developer or AI agent runs the README against the consuming app and creates whatever workspace structure is appropriate AT THAT POINT. Until then, the placeholder costs nothing.
- **Rejected alternatives:**
  - Empty `package.json` per placeholder (workspace graph member, no code): pollutes every cross-cutting tool, generates no-op CI tasks, opens phantom Renovate PRs.
  - Single `_modules/_placeholders/` README aggregating all of them: loses the per-module URL anchor (`_modules/<name>/README.md`) that the catalogue cross-links to. Worse navigation for AI assistants.
  - Promote every placeholder to a real workspace package up front: spends Phase D budget on packages that may never ship in any MVP. Premature.
- **When to revisit:** When a placeholder is consumed by a real MVP. The promotion path (per ADR 07) is: scaffold the workspace package under `_modules/<name>/`, add `package.json` + `src/` + `tsconfig.json`, follow the Pattern A activation rules (env var presence, transpilePackages, instrumentation hook). The README stays as the activation guide.
