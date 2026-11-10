---
date: 2026-05-09
title: "Centralized vitest base config with `passWithNoTests`"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Centralized vitest base config with `passWithNoTests`

- **Date:** 2026-05-08
- **Decision:** `packages/config/vitest.base.ts` owns the shared vitest defaults for the monorepo, including `passWithNoTests: true`. Each package's `vitest.config.ts` re-exports the base config and only diverges when a package has package-specific needs (custom setup files, environment, coverage thresholds).
- **Why:** Skeleton packages without tests yet (typical mid-phase state) would otherwise fail `bun run test` and break the Turborepo pipeline. Setting `passWithNoTests` once at the source means every future package skeleton inherits it instead of replicating a `--passWithNoTests` plaster in each `package.json`. Aligns with how the monorepo already centralizes biome (`biome.base.json`) and tsconfig (`tsconfig.lib.json`). The file stays `.ts` to match the rest of the workspace (no exception for config files); cross-package loading works natively because the workspace runs Node 24 LTS everywhere (CI + dev + `engines.node >= 24`) and Node 23.6+ ships `--experimental-strip-types` on by default. No flag is needed.
- **Rejected alternatives:**
  - `--passWithNoTests` flag per-package: replicates across every future skeleton, drifts over time, and hides the convention from contributors.
  - Inline duplication of the full base config in every `vitest.config.ts`: same drift problem, and changes to the base require touching every package.
  - Skipping the test step entirely on empty packages via Turborepo task filters: hides genuinely missing test files behind a config quirk and is harder to debug than a one-liner config.
  - Renaming the file to `.mjs` to dodge Node's `.ts` loading limitation: works without flags on every Node version but breaks the workspace's "everything is `.ts`" invariant. As soon as the base config grows typed helpers (generic test utilities, type-safe matchers, branded test fixtures), `.mjs` becomes a migration tax. The flag-based path keeps the door open at zero ongoing cost.
- **When to revisit:** If a package legitimately wants to fail-on-empty (e.g. a contracts package where missing tests are a regression), override `passWithNoTests` locally in that package's `vitest.config.ts`. If Node ever stabilizes `.ts` loading in a way that subsumes `--experimental-strip-types` (i.e., the flag becomes the default no-op), no doc change required; the runtime contract just absorbs it.
- **Last revised:** 2026-05-09 (Phase D CI workflow initially failed on cross-package `.ts` loading because the runner shipped an older Node by default; resolved by pinning Node 24 LTS in CI and bumping `engines.node` rather than reformatting the source file or relying on a flag).
