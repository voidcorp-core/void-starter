---
date: 2026-07-26
title: "Accept Neon migration only after empty-to-current history attestation"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Accept Neon migration only after empty-to-current history attestation

- **Date:** 2026-07-26
- **Decision:** Accept the first migration lifecycle after an isolated Neon canary authenticated
  the exact provisioned project, observed an empty Drizzle history, applied every published SQL
  entry in one attempt, and re-read the complete ordered history with the planned latest tag,
  SHA-256 and timestamp. Require the receipt to pass `doctor`, remain mode `0600`, and leave the
  publishable source digest unchanged. Keep provider IDs and canary-specific hashes in the excluded
  operational handoff only.
- **Why:** Mock databases prove plan and recovery logic but cannot prove current Neon connection
  URI behavior, direct endpoint compatibility, PostgreSQL advisory locking, Drizzle transactions,
  or durable migration-log writes. The live transition from zero to the exact planned count covers
  the mutation path and its immediate reconciliation, while local postchecks protect receipt and
  source-isolation invariants.
- **Rejected alternatives:**
  - Accept a successful Neon connection only: proves credentials, not schema mutation.
  - Inspect application tables without migration history: loses the binding between database state
    and the exact published SQL sequence.
  - Store the connection URI for later verification: creates a durable database credential leak.
  - Treat CI's ephemeral PostgreSQL migration as the production canary: does not exercise Neon or
    the provisioned project boundary.
- **When to revisit:** Re-run after Neon connection-URI or Drizzle migrator contract changes, and
  whenever migration strategy moves away from ordered SQL files and the Drizzle history table.
