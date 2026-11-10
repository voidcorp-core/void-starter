---
date: 2026-11-10
title: "Move Better Auth to the 1.7.x patch line; widen the security overrides"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-11-10: Move Better Auth to the 1.7.x patch line; widen the security overrides

- **Date:** 2026-11-10
- **Decision:** `better-auth` and `@better-auth/drizzle-adapter` move from `~1.6.34` to `~1.7.19`
  in `apps/web` and `packages/auth`. This supersedes ADR 71. The tilde stays, so a future 1.8
  is again a deliberate step. The root overrides of ADR 36 also change: `dompurify` 3.4.17,
  `fast-uri` 3.1.9, `qs` 6.16.1 and `undici` 7.30.2 replace their vulnerable pins, and `zod`
  4.6.7, `body-parser` 2.4.0, `glob` 14.0.4 and `minimatch` 11.0.5 are added. ADR 36 keeps its
  text per the append-only rule; `package.json#overrides` is the current list.
- **Why:** The 1.6 line has no backport for GHSA-965c-763c-88jm (critical: an OAuth state can be
  replayed as a magic link to sign in as another user) or GHSA-r4xp-prcw-77qf (high: OAuth proxy
  account takeover). The starter enables both magic link and Google OAuth, so it is exposed; both
  are fixed only from 1.7.7. The reason ADR 71 held 1.7 back is gone: Better Auth 1.7.3 removed
  the required `account.issuer` column, and the official 1.7 upgrade guide states the account
  schema is unchanged from 1.6. `getAuthTables` on 1.7.19 with the starter's plugins (`admin`,
  `magicLink`, database rate limit) lists exactly the columns `packages/db` already declares, so
  no migration is written. None of the 1.7 breaking changes touch an API the starter calls
  (OAuth provider, MCP, SCIM, SSO, generic OAuth, two-factor, captcha, custom storage). The new
  overrides follow ADR 36: each owner's latest in-range release still resolves the vulnerable
  version. `glob` 14 and `minimatch` 11 cross a major: their owners (Sentry bundler plugins,
  `@oclif/core`, `@swc/cli`, `@vercel/queue`, `filelist`) call only `glob()` and
  `minimatch()` / `minimatch.match()`, which both majors keep, and Sentry's own 11.x line already
  requires `glob` ^14.
- **Rejected alternatives:**
  - Stay on 1.6 and ignore the advisories: ADR 36 rejects severity filtering, and these are
    exploitable account takeovers in the default configuration.
  - Move to Sentry 11 instead of overriding `glob`: a major upgrade of the observability module,
    outside the scope of a security fix. The override goes away when that upgrade lands.
- **Acceptance evidence:** `bun audit` reports no vulnerability; `bun run lint`,
  `bun run type-check`, `bun run test`, `bun run knip` and `bun run build` are green. The
  `@repo/auth` integration suites that need a database stay skipped locally and run in CI.
- **When to revisit:** On every dependency update, remove each override whose owners resolve a
  patched release themselves. Move to 1.8 deliberately, after reading its upgrade guide.
