---
date: 2026-07-25
title: "Validate first-tranche provisioning through creation, resume and stateless adoption"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Validate first-tranche provisioning through creation, resume and stateless adoption

- **Date:** 2026-07-25
- **Decision:** Accept the GitHub repository, Vercel project, Neon project and Vercel database
  binding tranche after a live isolated-account canary created all four resources in one attempt,
  a completed-state resume preserved every ID and attempt counter, and a fresh generated project
  without local apply state adopted every resource with the same opaque IDs. Keep the sandbox
  resources for the next source, migration and deployment tranche.
- **Why:** Provider-mocked tests prove request contracts but cannot prove current provider API
  behavior, app installation access, environment-variable semantics or lookup compatibility.
  Creation alone also cannot prove that recovery avoids duplicates. The three canary perspectives
  jointly cover first execution, durable no-op resume and lookup-based adoption.
- **Rejected alternatives:**
  - Treat the first successful creation as sufficient: leaves adoption and duplicate prevention
    unproven.
  - Delete the resources immediately: prevents the next tranche from exercising a realistic
    existing project.
  - Persist provider credentials or the Neon connection URI as evidence: violates the
    process-memory-only secret boundary.
- **When to revisit:** Re-run the same three canaries after a provider API contract change, and add
  remote smoke checks once source push, migration and deployment actions exist.
