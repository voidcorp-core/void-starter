---
date: 2026-07-26
title: "Migrate exact published Drizzle history before defining product seed"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Migrate exact published Drizzle history before defining product seed

- **Date:** 2026-07-26
- **Decision:** Add a separate `migration:plan|preflight|live|resume` lifecycle. Bind its plan to
  the successful source-publication commit/digest, provisioned Neon identity, and the exact ordered
  Drizzle journal with each SQL SHA-256 and timestamp. Retrieve a direct Neon connection URI only
  into process memory. Require the remote migration log to be an exact prefix, hold a PostgreSQL
  advisory lock, apply pending entries through Drizzle's transaction, re-read the full history and
  persist only non-secret evidence in `.void-starter/migration-state.json`. Keep administrator
  bootstrap/seed separate until Better Auth onboarding supplies an explicit identity.
- **Why:** Running an unbound `drizzle-kit migrate` proves neither which published source supplied
  the SQL nor whether a remote database has divergent history. Local and database locks plus
  Drizzle's migration transaction make an interrupted attempt safely inspectable and resumable.
  Conversely, the current manifest contains no administrator email or invitation identity; a
  nominal seed would have to guess credentials or create misleading sample production data. The
  API and history contracts follow Neon's
  [connection URI endpoint](https://api-docs.neon.tech/reference/getconnectionuri) and Drizzle's
  [migration log](https://orm.drizzle.team/docs/drizzle-kit-migrate).
- **Rejected alternatives:**
  - Run `drizzle-kit migrate` manually with an exported URI: lacks plan binding, safe receipt and
    history-conflict diagnostics.
  - Read `DATABASE_URL` back from Vercel: sensitive Production variables are intentionally
    write-only to the Factory.
  - Use the pooled application URI: migrations and advisory locking belong on a direct database
    session, not the runtime pooler.
  - Seed a placeholder admin or demo note: creates privileged or misleading production records
    without product intent.
- **When to revisit:** Add a separate bootstrap receipt when the auth contract defines the exact
  administrator/invitation identity and real Resend delivery. Revisit the lock/migrator only if
  Drizzle changes its PostgreSQL transactional migration semantics.
