---
date: 2026-07-25
title: "Resolve the web tsconfig base by workspace-relative path"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Resolve the web tsconfig base by workspace-relative path

- **Date:** 2026-07-25
- **Decision:** Let `apps/web/tsconfig.json` extend
  `../../packages/config/tsconfig.next.json` directly. Keep package exports for runtime/tool
  imports, but do not depend on package-subpath resolution for TypeScript configuration
  inheritance.
- **Why:** The live canary's complete quality job passed, then Playwright 1.61 failed before test
  discovery because its internal tsconfig loader could not resolve
  `@repo/config/tsconfig.next.json` on Linux. TypeScript and Bun resolved the same path, making the
  problem invisible to lint, type-check, unit tests and builds. The relative path expresses the
  stable monorepo topology and works without a package-manager-specific resolver.
- **Rejected alternatives:**
  - Skip E2E in CI: removes the only browser-level gate.
  - Patch Playwright's loader or pin a platform-dependent workaround: couples the starter to an
    implementation detail that the local TypeScript compiler does not need.
  - Duplicate the shared config into `apps/web`: creates configuration drift.
- **When to revisit:** Reconsider package-specifier inheritance only when every supported
  TypeScript consumer, including Playwright's loader, resolves it consistently on Linux.
