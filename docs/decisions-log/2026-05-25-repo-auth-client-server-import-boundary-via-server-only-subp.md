---
date: 2026-05-25
title: "`@repo/auth` client/server import boundary via 'server-only' + subpath split"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: `@repo/auth` client/server import boundary via 'server-only' + subpath split

- **Date:** 2026-05-09
- **Decision:** Server-only modules in `@repo/auth` (`auth.service`, `auth.repository`, `auth-action`) and `@repo/db/client` each carry `import 'server-only'` at the top. Client components (auth pages, UserMenu) import `authClient` from the `@repo/auth/client` subpath. Server components and actions continue to import from `@repo/auth` (barrel) or its named subpaths.
- **Why:** The `@repo/auth` index barrel mixed browser-safe exports (`authClient`, errors, helpers, types) with server-only exports (`getCurrentUser`, `requireAuth`, `requireRole`, `signOut`, `defineAction`, `defineFormAction`). Any client component importing a single symbol from the barrel transitively pulled in `auth.service` → `next/headers`, and `auth.repository` → `@repo/db/client` → `postgres` (Node-only built-ins: `fs`, `crypto`, `stream`, `perf_hooks`). Next.js / Turbopack correctly refused to bundle these into the client, causing a hard build failure. The `server-only` directive makes the boundary explicit and loud at build time — it throws an actionable error instead of silently including server internals. The `@repo/auth/client` subpath gives auth pages an unambiguous browser-safe entry point.
- **Rejected alternatives:**
  - Split `@repo/auth` into separate packages (e.g. `@repo/auth-client`, `@repo/auth-server`): too heavy — adds monorepo overhead, extra `package.json` files, and forces every consumer to track two package names for a single domain.
  - Add `'use client'` at the top of server-side files: wrong primitive — `'use client'` is a React component boundary directive, not a build-time bundling constraint. It would mark the service as a client module, not prevent its server-only dependencies from leaking.
  - Leave the barrel as-is and rely on tree-shaking: Next.js / Turbopack does not statically tree-shake across package boundaries at the module-init level. Side-effecting imports (like `next/headers` and `postgres`) are always evaluated even if no exported symbol is used by the client.
- **When to revisit:** If Next.js / RSC bundling gains reliable cross-package server-only tree-shaking that makes the `server-only` package redundant (unlikely in the short term). Until then, every new server-only file added to `@repo/auth` or `@repo/db` must carry the directive.
