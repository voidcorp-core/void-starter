# @repo/jobs-vercel-workflow -- Durable jobs on the Vercel Workflow DevKit

- **State:** real package, type-checked + tested, wired into `apps/web` when the manifest selects it
- **Selected by:** `workloads.durable_jobs: vercel-workflows`
- **Env vars:** none. The Vercel World is selected automatically on deployment and configures its
  own storage, queueing and OIDC authentication.
- **Pattern:** A. Workspace package holding the job payload contract and the idempotency ledger.
  The `"use workflow"` / `"use step"` files live in `apps/web/src/workflows/` because the Next.js
  compiler, enabled by `withWorkflow()` in `next.config.ts`, is what transforms those directives.

## Why there is nothing to provision

Unlike R2, Sentry or PostHog, durable jobs create no third-party resource and bind no secret. When
the app is deployed to Vercel, the Workflow SDK selects the Vercel World, which supplies storage,
distributed queueing and authentication with zero configuration. The build step also registers each
step handler so only Vercel Queue can deliver to it, which is why the handlers are not reachable
from the public internet and carry no auth logic of their own.

## Data residency -- read this before selecting the adapter

The Vercel World is deployed **only in `iad1`**. Workflow run data is stored there regardless of
where the application is deployed, so selecting durable jobs on an `eu_primary` project is a
transfer outside the EU. Two things make it defensible, and both are load-bearing:

1. **End-to-end encryption.** Workflow inputs, step inputs, return values, hook payloads and stream
   frames are encrypted with AES-256-GCM under a per-run key before they reach the event log; the
   backend only ever sees ciphertext. Workflow names, step names, entity IDs and timestamps stay in
   clear text as metadata.
2. **The opaque-reference contract.** `jobReferenceSchema` rejects anything shaped like personal
   data -- an email address, a name, an address, free text. Payloads carry an opaque application
   reference and steps re-read the real record from Neon EU.

Neither removes the transfer, so the manifest has to approve it explicitly under
`data_residency.approved_non_eu_processors` (ADR 62). A manifest that selects durable jobs without
that approval is rejected.

## Idempotence

Every step writes `job_executions` keyed by its Workflow `stepId`, under a unique index. `stepId` is
stable across retries of a step and unique per step invocation, which is exactly the contract an
idempotency key needs -- and why the key must never derive from a timestamp or an attempt counter.
A replayed step therefore updates its own row and increments `attempts` rather than inserting a
second one, so the side effect happens exactly once while replays stay observable.

`apps/web/src/workflows/canary-job.workflow.ts` then re-reads the ledger after its suspension and
throws `FatalError` if the row is missing, belongs to another reference, or is duplicated. A broken
invariant is never transient, so it must not be retried.

## Install

The factory wires this automatically when the manifest selects the workload. To wire it by hand:

1. `bun add workflow` in `apps/web`, and add `@repo/jobs-vercel-workflow` as a workspace dependency.
2. Wrap the Next config: `export default withWorkflow(config)` from `workflow/next`, and add
   `@repo/jobs-vercel-workflow` to `transpilePackages`.
3. **Exclude `.well-known/workflow/` from the proxy matcher.** The SDK resumes runs by POSTing to
   its own internal endpoint; a proxy that intercepts it corrupts the queued payload. Next 16
   renamed `middleware.ts` to `proxy.ts`, which makes this easy to lose in a migration.
   `apps/web/src/proxy.test.ts` pins the exclusion.
4. Run the `job_executions` migration (`packages/db/migrations/0004_rainy_blink.sql`).

## Observability

Runs are visible in the Vercel dashboard on the project page, under the existing project
permissions. Decrypting a run's data follows the same permission model as environment variables and
is recorded in the Vercel audit log.

```bash
bunx workflow inspect runs --backend vercel --project <project> --team <team>
bunx workflow inspect run <run-id> --backend vercel --decrypt
```

## Versioning

On Vercel, a run is pegged to the deployment that started it: in-flight runs finish on their
original deployment while new runs start on the latest one. A deploy therefore never breaks a
running job, but a long-running job keeps executing old code until it completes.
