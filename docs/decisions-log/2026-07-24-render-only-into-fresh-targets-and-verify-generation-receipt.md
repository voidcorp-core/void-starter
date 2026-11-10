---
date: 2026-07-24
title: "Render only into fresh targets and verify generation receipts"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Render only into fresh targets and verify generation receipts

- **Date:** 2026-07-24
- **Decision:** Local factory generation copies the tested baseline only into a non-existing
  directory outside the source repository. It rejects source symlinks, removes unselected
  surfaces, applies deterministic overlays, excludes secrets and development-governance
  artifacts, and emits a canonical manifest plus receipt under `.void-starter/`. `doctor`
  recalculates the plan and generated-file SHA-256 digests and scans dependencies for Void
  Harness. The source `bun.lock` is not copied; a newly installed lockfile is allowed and checked.
- **Why:** A generator that mutates its own baseline or overwrites an existing project makes
  recovery ambiguous. Fresh-target rendering is easy to retry and inspect. The receipt makes the
  generated portion tamper-evident without pretending that copied baseline files are immutable.
- **Rejected alternatives:**
  - Render in place: risks mixing partial output with the factory source and user changes.
  - Overwrite an existing target: makes ownership and rollback unclear.
  - Copy the source lockfile: retains the development-only `@repo/factory` workspace after factory
    source is excluded.
  - Copy symlinks: could make generated writes or removals escape the target boundary.
- **When to revisit:** Add an explicit upgrade/migration workflow only after it has a transactional
  plan, conflict reporting, backups, and a separate authorization path from fresh generation.
