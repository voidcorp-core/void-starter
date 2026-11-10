---
date: 2026-08-24
title: "Pin Better Auth to the 1.6.x patch line until the 1.7.x account migration lands"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-08-24: Pin Better Auth to the 1.6.x patch line until the 1.7.x account migration lands

- **Date:** 2026-08-24
- **Decision:** `better-auth` and `@better-auth/drizzle-adapter` are declared as `~1.6.30` in
  `apps/web`, `packages/auth`, and any consumer, rather than the caret ranges the rest of the
  starter uses. The tilde caps the resolver at the 1.6.x patch series while still admitting new
  patches, and holds 1.7 back until the Drizzle `account` schema and its migration catch up.
- **Why:** Better Auth 1.7.0 added an `issuer` column to the `account` model, and the runtime now
  refuses every sign-up with `The field "issuer" does not exist in the "account" Drizzle schema`
  until the schema in `packages/db` grows the column and a migration is written. The weekly
  dependency bump is scoped to in-range patch and minor moves that keep every gate green; a
  Drizzle schema change plus a database migration is separate work that deserves its own review,
  so the range is tightened here rather than shipping a red PR or writing the migration inside a
  bump.
- **Rejected alternatives:**
  - Taking the minor and adding the migration in the same PR: mixes an unrelated schema change
    into a routine dep bump and asks reviewers to evaluate both in one pass.
  - Leaving the caret at `^1.6.29` and hand-editing the lockfile back to 1.6.x: the next `bun
    install` and the next weekly bump would both re-pick 1.7 and re-break `@repo/auth`'s
    integration tests, and the constraint would carry no signal about why it happened.
  - Pinning an exact version (`1.6.30`): denies future 1.6.x security patches for no benefit;
    the tilde still admits them.
- **Acceptance evidence:** With the tilde in place, `bun install` resolves to `better-auth
  1.6.30`, `bun run lint`, `bunx turbo run type-check test build --force`, and `bun run knip` are
  all clean, and the auth integration and invite-only-HTTP suites pass again in CI.
- **When to revisit:** When `packages/db`'s `account` schema grows the `issuer` column, a Drizzle
  migration is written and merged, and Better Auth's 1.7 changelog is reviewed for anything else
  the starter relies on. At that point the tilde returns to a caret and the bump moves through
  the ordinary weekly path.
