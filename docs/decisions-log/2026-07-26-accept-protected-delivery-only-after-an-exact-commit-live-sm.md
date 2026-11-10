---
date: 2026-07-26
title: "Accept protected delivery only after an exact-commit live smoke"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Accept protected delivery only after an exact-commit live smoke

- **Date:** 2026-07-26
- **Decision:** Accept the first delivery-observation tranche after an isolated Vercel canary found
  the Production deployment for the exact published commit, observed `READY`, crossed Vercel
  Authentication with a process-memory-only automation bypass, and received HTTP 200 HTML
  containing the project identity. Require the resulting receipt to pass `doctor`, remain mode
  `0600`, and leave the publishable source SHA-256 unchanged. Keep provider IDs and canary-specific
  digests only in the excluded operational handoff, not in reusable generated documentation.
- **Why:** HTTP mocks prove request shape and failure semantics but cannot prove Vercel's current
  deployment metadata, team routing, protection redirect or bypass behavior. The canary connects
  the full evidence chain from the guarded Git source commit to the response body actually served
  by its immutable deployment URL, while the postchecks prove the operational receipt neither
  leaks into source nor weakens generated-project isolation.
- **Rejected alternatives:**
  - Accept `READY` without HTTP validation: proves Vercel's build state, not application delivery.
  - Accept the anonymous SSO 302: proves protection, not the application behind it.
  - Disable protection for the test: avoids the production boundary the lifecycle must support.
  - Persist the bypass as evidence: turns a successful security check into credential exposure.
- **When to revisit:** Re-run this canary after Vercel deployment/protection API changes. Add
  migration, authenticated-route and canonical-domain evidence as those lifecycle stages become
  available.
