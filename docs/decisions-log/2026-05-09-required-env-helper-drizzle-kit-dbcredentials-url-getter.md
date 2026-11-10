---
date: 2026-05-09
title: "`required()` env helper + drizzle-kit `dbCredentials.url` getter"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: `required()` env helper + drizzle-kit `dbCredentials.url` getter

- **Date:** 2026-05-08
- **Decision:** `@repo/core/env` exports a small `required(name: string): string` that throws `Missing required env var: <NAME>` on absent or empty values. `packages/db/drizzle.config.ts` consumes it through a `dbCredentials.url` getter, so the env read fires at command-time rather than at config-load time.
- **Why:** Config files consumed by CLIs (drizzle-kit) need a one-line, loud presence check; the full `createAppEnv` schema is overkill there. The getter is the load-bearing trick: knip's drizzle plugin only reads the `schema` key and loads the config without `DATABASE_URL`, while `drizzle-kit migrate`/`studio`/`push` still fail loud the moment they reach for the URL. `drizzle-kit generate` does not need a URL by design.
- **Rejected alternatives:**
  - Empty-string fallback in `drizzle.config.ts` to please knip: silent failure mode on `drizzle-kit migrate`. Loud failure beats silent default.
  - Inline `process.env['DATABASE_URL'] ?? throw ...` at the top of `drizzle.config.ts`: same behaviour at the cost of repeating the error message everywhere; centralising in `required()` keeps the contract uniform across packages.
  - Reusing `createAppEnv` in `drizzle.config.ts`: pulls Zod and the t3-env runtime into a config file that only needs a presence check, and would still need the getter trick to defer the read.
- **When to revisit:** If knip exposes a directive to skip a single config file from plugin-driven evaluation, the getter can be replaced by a plain expression with `required()`. If `required()` grows beyond presence checks (validation, defaults, transforms), promote those use cases to `createAppEnv` rather than expanding the helper.
