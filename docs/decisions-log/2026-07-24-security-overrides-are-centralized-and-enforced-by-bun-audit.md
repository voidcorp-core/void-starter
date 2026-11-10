---
date: 2026-07-24
title: "Security overrides are centralized and enforced by `bun audit`"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Security overrides are centralized and enforced by `bun audit`

- **Date:** 2026-07-24
- **Decision:** The root `package.json#overrides` is the single place for temporary transitive security pins. It currently fixes `brace-expansion`, `dompurify`, `esbuild`, `fast-uri`, `js-yaml`, `postcss`, `sharp`, `undici`, and `vite`. The root `audit` script runs `bun audit`, and the `quality` CI job executes it immediately after the frozen install.
- **Why:** All direct dependencies were already on their latest release, but their resolved trees still produced 28 advisories. Updating owners removed most findings; the remaining packages were held behind stale exact or pre-1.0 ranges in current Next, Drizzle Kit, Sentry, PostHog, and Vitest releases. Centralized overrides moved every affected transitive package to a patched release and reduced the audit to zero without pretending the packages are direct project dependencies. The range-crossing overrides for PostCSS, sharp, and esbuild were accepted only after the production Next build, all type checks, 123 unit tests, Knip, and Drizzle schema generation passed.
- **Rejected alternatives:**
  - Add transitive packages as root dependencies: does not reliably replace nested versions and falsely expands the application's direct API surface.
  - Ignore or severity-filter advisories: makes the report quieter without removing vulnerable code.
  - Leave current direct packages pinned until upstream ranges catch up: keeps known vulnerable artifacts in the lockfile even though patched releases pass the project pipeline.
  - Patch files inside `node_modules`: not reproducible and disappears on install.
- **When to revisit:** On every dependency update. Remove an override as soon as all owners resolve a patched version themselves, regenerate `bun.lock`, and require both the full validation pipeline and `bun audit` to remain green.
