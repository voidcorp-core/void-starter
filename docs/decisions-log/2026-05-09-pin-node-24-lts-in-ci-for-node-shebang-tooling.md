---
date: 2026-05-09
title: "Pin Node 24 LTS in CI for Node-shebang tooling"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Pin Node 24 LTS in CI for Node-shebang tooling

- **Date:** 2026-05-09; revised 2026-07-24
- **Decision:** Both jobs in `.github/workflows/ci.yml` declare `actions/setup-node@v6` with `node-version: '24'` immediately after `oven-sh/setup-bun@v2`. The root `package.json#engines.node` declares `>=24` to make the workspace contract explicit, and every direct `@types/node` dependency stays on major 24 to match that runtime. No `NODE_OPTIONS` flag is set: Node 23.6+ ships `--experimental-strip-types` on by default, so cross-package `.ts` config loading works natively. Bun stays pinned at `1.3.14` in both CI and `packageManager`.
- **Why:** Bun is the workspace runtime, but several tools we depend on (Vitest, Drizzle Kit, Playwright, Sentry's webpack plugin) ship binaries with a `#!/usr/bin/env node` shebang. When `bun run test` invokes those binaries, they execute under Node, not Bun. Two consequences follow: (1) without explicit `setup-node`, the runner uses whatever Node version `ubuntu-latest` happens to ship (historically 18 or 20), producing non-deterministic CI behaviour. (2) Without modern Node, the loader refuses to load `.ts` files reached through cross-package `package.json#exports` (the case for `@repo/config/vitest.base`). Pinning Node 24 LTS gives us: (a) reproducible CI builds, (b) `.ts` consistency across the entire workspace including shared cross-package configs WITHOUT any flag, (c) parity with the local dev runtime (Folpe runs Node 24.x), (d) automatic version pickup for contributors via `nvm`/`fnm`/Volta reading `engines.node`. The flag-free path is the cleaner architectural choice: nothing experimental in the build contract, no `NODE_OPTIONS` to maintain.
- **Rejected alternatives:**
  - Skip `setup-node` and use whatever the runner ships: non-deterministic; CI breaks every time the runner image rotates Node versions.
  - Pin Node 22 LTS + set `NODE_OPTIONS=--experimental-strip-types`: works, but the flag's name carries the word "experimental" and adds a workflow-level moving part that exists purely to dodge a runtime version. Strictly less clean than upgrading to a Node version where the feature is default-on. Initially considered to "match Vercel Functions LTS" but CI does not deploy to Vercel; the runtime alignment argument was weak.
  - Pin Node 18 or 20: predates `--experimental-strip-types` entirely (added in 22.6). Strict downgrade; blocks `.ts` cross-package loading.
  - Reformat `packages/config/vitest.base.ts` as `.mjs` to dodge the version requirement: works without any Node version pin but breaks the "everything is `.ts`" invariant for a cosmetic Node-tooling concern. Rejected per ADR 14's revision.
  - Replace Vitest with Bun's native test runner: removes the Node dependency entirely, but Vitest's ecosystem (jsdom, @testing-library/react integration, coverage reporters, vite transformer pipeline) is non-trivial to replace. Bigger lift than is warranted; revisit if Bun test ships first-class jsdom + RTL parity.
  - Invoke Vitest under Bun explicitly via `bunx --bun vitest run`: changes every package's `test` script and adds friction for contributors who run vitest from their IDE. The Node pin is the smaller, more reversible change.
- **When to revisit:** When Bun test reaches feature parity with Vitest for our use cases (jsdom, coverage, RTL), at which point we can drop the Node dependency entirely and remove this pin. Move both the runtime and `@types/node` together when Node 26 reaches LTS and the deploy target supports it. If Vercel Functions ever lags Node 24 (currently supports 18, 20, 22, 24 as of 2026-05), the deploy runtime is a separate concern from CI testing and is configured per-project; no change to this ADR.
