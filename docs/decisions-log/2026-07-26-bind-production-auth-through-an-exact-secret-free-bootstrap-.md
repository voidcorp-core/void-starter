---
date: 2026-07-26
title: "Bind production auth through an exact, secret-free bootstrap plan"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Bind production auth through an exact, secret-free bootstrap plan

- **Date:** 2026-07-26
- **Decision:** Add a separate `auth:plan|preflight|live|resume` lifecycle after source publication
  and database migration. Keep canonical URL, verified Resend sender and exact bootstrap
  administrator in a strict non-secret context; read `VERCEL_TOKEN`, `BETTER_AUTH_SECRET` and
  `RESEND_API_KEY` only from process memory. Bind the two runtime secrets as Production-only
  Vercel Sensitive variables and the remaining runtime configuration as encrypted variables. Use
  a plain plan-digest ownership marker for reconciliation, send one idempotent configuration email
  to validate the sending boundary, and persist only opaque IDs and non-secret evidence. Grant
  `admin` through Better Auth's user-create hook only when the normalized new-user email exactly
  matches the planned identity. Require a new Production deployment before testing auth.
- **Why:** Authentication cannot be production-ready while its canonical origin, email provider
  and first administrator depend on dashboard folklore. At the same time, a seed with an invented
  password or placeholder user creates a durable privileged credential the product never asked
  for. Exact identity intent lets the real person establish their own Better Auth account while
  the hook atomically assigns the initial role. Vercel Sensitive values are write-only, so an
  explicit non-secret marker is the only safe way to distinguish adoption from foreign or partial
  configuration. Production-only targeting prevents previews from sharing the production
  database and authentication secrets.
- **Rejected alternatives:**
  - Store API keys or `BETTER_AUTH_SECRET` in the auth context or receipt: makes reproducible intent
    and operational evidence secret-bearing.
  - Seed an admin with a generated/default password: creates an unmanaged privileged credential.
  - Promote the first arbitrary signup: makes a deployment race determine production ownership.
  - Read Sensitive values back to compare them: Vercel deliberately makes them unreadable and the
    comparison would widen secret exposure.
  - Bind the production database/auth keys into Preview: couples untrusted preview code and branch
    authors to production identity and data.
  - Treat successful variable creation as a deployed configuration: Vercel injects environment
    changes only into subsequent deployments.
- **When to revisit:** Replace static API tokens with workload identity where providers support it.
  Add a guarded redeployment and authenticated-route observation receipt after the isolated live
  auth canary establishes the current Vercel and Resend contracts.
