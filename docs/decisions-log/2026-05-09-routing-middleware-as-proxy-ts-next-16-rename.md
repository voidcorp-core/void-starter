---
date: 2026-05-09
title: "Routing Middleware as `proxy.ts` (Next 16 rename)"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Routing Middleware as `proxy.ts` (Next 16 rename)

- **Date:** 2026-05-09
- **Decision:** `apps/web` uses `src/proxy.ts` exporting a `proxy` function (not `src/middleware.ts` exporting `middleware`). Knip's `apps/*` entry list points at `src/proxy.ts`. The `runtime` config option is intentionally NOT declared because Next 16 explicitly throws when it appears in proxy files.
- **Why:** Next.js 16.0.0 deprecated the `middleware` file convention and renamed it to `proxy` (https://nextjs.org/docs/app/api-reference/file-conventions/proxy, version history: "v16.0.0 — Middleware is deprecated and renamed to Proxy"). The Next team's stated motivation is to disambiguate from Express-style middleware, signal the network-boundary semantics (proxy runs at the edge / before render), and discourage overuse. The starter ships on Next 16; using the deprecated convention would emit a build-time warning and rot at the next minor.
- **Rejected alternatives:**
  - Keep `middleware.ts` and silence the deprecation warning: works today, breaks on a future Next minor that removes the alias. The codemod (`npx @next/codemod@canary middleware-to-proxy .`) is a one-shot anyway.
  - Drop the proxy file entirely (no session refresh slot): closes off the Phase D plug point for `_modules/rate-limit-upstash` and locale detection. Future modules would have to add the file from scratch.
- **Knip config:** `apps/*` entry list MUST list `src/proxy.ts`, NOT `src/middleware.ts`. Already updated in `knip.json` alongside this ADR.
- **Phase C plan note:** the plan snippet for Task C7 was drafted before the Next 16 rename and uses `src/middleware.ts` / `export function middleware`. The implementer correctly verified docs and adapted. Future plan revisions should reflect the new naming.
- **When to revisit:** Only if Next reverts the rename (very unlikely) or introduces a successor convention that subsumes proxy.
