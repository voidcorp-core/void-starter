---
date: 2026-07-24
title: "Prove resumable provisioning locally before enabling provider mutations"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Prove resumable provisioning locally before enabling provider mutations

- **Date:** 2026-07-24
- **Decision:** Add a strict, non-secret provisioning context for explicit GitHub owner, Vercel
  team and Neon organization coordinates. Derive a deterministic first-tranche action plan for
  repository, web project, database project and database environment binding. Every action has a
  content-derived idempotency key, dependencies and required permission intent. Implement
  `apply --dry-run` as the write-free default and `apply --simulate` / `resume --simulate` as a
  local-only execution engine. Persist canonical state atomically after each transition, prevent
  concurrent applies with a process lock, recover dead-process locks, preserve safe structured
  failures, reject manifest or plan drift, and skip already successful actions on resume.
  `doctor` validates optional provisioning state. No live execution flag exists in this tranche.
- **Why:** The retry contract must be correct before API credentials or billable resources enter
  the loop. Neon explicitly warns that retrying an ambiguous create-project `POST` may create a
  duplicate, so a live adapter must reconcile stable ownership metadata and persist returned
  opaque IDs instead of treating a POST retry as idempotent. GitHub organization repository
  creation requires repository-administration write permission, and Vercel team-scoped API calls
  require an explicit team identifier. Separating product intent from account coordinates makes
  those permissions visible without putting credentials in the manifest. Provider references:
  [Neon create project](https://api-docs.neon.tech/reference/createproject),
  [GitHub repositories API](https://docs.github.com/en/rest/repos/repos),
  [Vercel REST API](https://vercel.com/docs/rest-api), and
  [Vercel regions](https://vercel.com/docs/regions).
- **Rejected alternatives:**
  - Add real provider calls directly to `generate`: couples deterministic local rendering to
    credentials, network availability and partial remote side effects.
  - Accept tokens in the manifest or provisioning context: turns reproducible intent files and
    receipts into secret-bearing artifacts.
  - Retry create endpoints blindly: can duplicate resources after ambiguous timeouts.
  - Infer owner, team, organization or returned resource IDs: risks mutating the wrong account
    and makes resume unreliable.
  - Keep state only in memory: loses the last confirmed provider action on interruption.
- **When to revisit:** Enable a separately explicit live mode only after GitHub, Vercel and Neon
  adapters implement lookup-before-create reconciliation, authenticated account preflight,
  permission checks, redacted transport logging, provider-mocked contract tests and manual
  sandbox-account validation. Add encrypted secret transport as a distinct reviewed tranche.
