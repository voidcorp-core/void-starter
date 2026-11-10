---
date: 2026-07-28
title: "Gate durable jobs behind an explicit non-EU processor approval"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-28: Gate durable jobs behind an explicit non-EU processor approval

- **Date:** 2026-07-28
- **Decision:** `workloads.durable_jobs: vercel-workflows` is the durable-jobs adapter, and it
  requires the Next.js web surface, a selected database and the Better Auth provider. Because the
  Vercel World stores workflow run data in `iad1` whatever the deployment region, the manifest
  must name `vercel-workflows` under the new optional `data_residency.approved_non_eu_processors`
  list. A manifest that selects durable jobs without that approval is rejected, and an approval
  that no selected workload requires is rejected too. The job payload contract carries only opaque
  references (`jobReferenceSchema`): personal data stays in Neon EU and steps re-read it by
  reference. Idempotence is a database property, not a convention -- each step writes
  `job_executions` keyed by its Workflow `stepId` under a unique index, so a replayed step
  increments `attempts` instead of duplicating the side effect, and the workflow re-reads the
  ledger and fails with `FatalError` if the row is missing, mismatched or duplicated.
- **Why:** The manifest already demanded `requires_approval`, `requires_dpa` and
  `requires_transfer_assessment` for any non-EU processor, but offered no field to record that the
  approval was granted. Durable jobs therefore crossed an EU boundary as a side effect of an enum
  value, on a profile that declares `personal_data: eu_required`. Making the approval an explicit,
  versioned manifest entry turns the transfer into a written decision that Forge must surface to a
  human (issue 11), and the rejection of unused approvals stops dead approvals from accumulating.
  The `stepId` idempotency key is the pattern the Workflow SDK documents: stable across retries and
  unique per step invocation, unlike any timestamp- or attempt-derived key.
- **Rejected alternatives:**
  - Document the `iad1` transfer without enforcing it: leaves an `eu_required` manifest exporting
    run data with no gate, which is exactly the failure the residency block exists to prevent.
  - Rely only on the opaque-reference contract: keeps personal data in the EU but still transfers
    pseudonymous identifiers, which remain personal data under the GDPR, with no recorded approval.
  - Forbid `vercel-workflows` on `eu_primary` projects: removes the capability entirely rather than
    making its cost explicit; every current profile is `eu_primary`.
  - Make the approval a required field: breaks every existing manifest that has no durable jobs,
    for no safety gain. Optional with a rejection rule is equivalent and backward compatible.
  - Deploy the app to `iad1` to colocate with the workflow backend: trades the application's own EU
    residency for latency, which inverts the priority the residency policy sets.
  - Prove idempotence with an in-memory or receipt-only counter: neither survives the suspension
    that makes the job durable in the first place.
- **Acceptance evidence:** Schema tests cover approval-missing rejection, orphan-approval
  rejection, duplicate approvals and the web/database/auth prerequisites. Composition tests cover
  pruning and wiring in both directions. The workflow suite covers the replay, missing-row,
  mismatched-reference and duplicated-row paths. The production build registers the SDK endpoints
  under `/.well-known/workflow/v1/`, which `apps/web/src/proxy.ts` must keep excluded from its
  matcher -- `src/proxy.test.ts` pins that exclusion. The live canary remains the final gate.
- **When to revisit:** Revisit when the Vercel World deploys an EU region, which would remove the
  transfer and the approval requirement for this processor. Extend
  `approved_non_eu_processors` when a second non-EU processor appears, and revisit the Better Auth
  prerequisite when a Clerk-compatible jobs trigger exists.
