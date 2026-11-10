---
date: 2026-06-18
title: "`@repo/notes` is the first domain package and the canonical Cache Components example"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-06-18: `@repo/notes` is the first domain package and the canonical Cache Components example

- **Date:** 2026-06-18
- **Decision:** Ship a minimal `notes` domain as a workspace package `@repo/notes` (layered: `notes.types.ts` / `notes.repository.ts` / `notes.service.ts` / `index.ts`) plus a `notes` table in `@repo/db`, a `createNoteAction` in `apps/web/src/actions/`, and a `/notes` page. The service read `listNotes(userId)` carries `'use cache'` + `cacheTag(\`notes:list:user:\${userId}\`)`+`cacheLife('minutes')`; the action invalidates that exact tag with `updateTag`after a write. This is the repo's first real read/write use of Cache Components, referenced as the worked example in`docs/CACHING.md`.
- **Why:** `docs/CACHING.md` documented the read-caches-at-service / write-invalidates-at-action pattern only as pseudocode, because no domain service existed yet (auth deliberately does not cache, CACHING.md section 7). A starter whose flagship Next 16 feature (`cacheComponents: true`) has zero call sites teaches the pattern by assertion, not by example. `notes` is the smallest domain that exercises the full loop (user-scoped cached read, tagged invalidation on write, progressive-enhancement form via `useActionState`). A package -- not an app-level use-case -- because services live in packages by the layering rules (ARCHITECTURE/PATTERNS), and `notes` has a clear domain scope, which is exactly the bar ADR 07 sets for a package to exist. The tag is user-scoped (`notes:list:user:<id>`) to honor the cross-tenant rule (CACHING.md section 6): a global `notes` tag would serve one user's list to another and would over-invalidate.
- **Rejected alternatives:**
  - _Cache the admin user-list / retrofit auth instead_: contradicts CACHING.md section 7 (auth does not cache; session reads should not be tagged like a record) and would cache PII-adjacent auth data as the teaching example. A neutral domain is clearer.
  - _Put the service in `apps/web` as a use-case_: violates the layering (services live in packages, only actions live in apps) and would not demonstrate the package-level convention future domains follow.
  - _Doc-only example_: leaves `cacheComponents: true` with no real call site; the pattern stays unproven against the actual toolchain (Turbopack, the TS 7 setup, the build).
- **When to revisit:** `notes` is intentionally minimal (no update/delete, no pagination). If MVPs never grow a second domain that caches, that is fine -- this one stays as the reference. When a richer domain lands (posts, projects, billing), it follows this shape from day one; if a cross-cutting caching helper emerges across three or more such domains, extract it then (not before).
