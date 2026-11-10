---
date: 2026-05-07
title: "No micro-packages"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: No micro-packages

- **Date:** 2026-05-07
- **Decision:** A workspace package exists if and only if (a) it has a clear domain scope (auth, db, ui, core, config), OR (b) it will be consumed by 2+ apps. Forbidden: `@repo/utils`, `@repo/constants`, `@repo/hooks`, `@repo/types`, `@repo/helpers`.
- **Why:** Each package costs a `package.json`, a `tsconfig.json`, a build step, cross-package imports, Renovate entries, and CI overhead. Micro-packages multiply this cost without delivering domain value. KISS prevails.
- **Rejected alternatives:**
  - Atomic-style decomposition (`@repo/types`, `@repo/utils`, etc.): premature abstraction, slow iteration, unclear ownership
  - Single mega-package (`@repo/lib`): defeats the purpose of monorepo isolation
- **When to revisit:** If a real cross-app reuse case emerges that does not fit existing packages. Then create the new package with clear domain scope; do not split existing packages into smaller ones for ergonomic reasons.
