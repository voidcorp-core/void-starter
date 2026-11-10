---
date: 2026-07-27
title: "Separate Sentry control-plane provisioning from release-upload credentials"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-27: Separate Sentry control-plane provisioning from release-upload credentials

- **Date:** 2026-07-27
- **Decision:** Extend the deterministic provider plan with `sentry.project` and
  `vercel.sentry-binding` whenever a Next.js project selects the Sentry error adapter. Keep only
  the exact organization slug, team slug and literal `de` region in the strict non-secret
  provisioning context. Use `SENTRY_API_TOKEN` for authenticated organization/team preflight,
  lookup-before-create and project/client-key reads against `de.sentry.io`. Fix the project
  platform to `javascript-nextjs`, require one exact active client key, and persist only opaque
  project/key IDs plus a SHA-256 of the public DSN. Use the separate optional
  `SENTRY_BUILD_AUTH_TOKEN` only when binding `SENTRY_AUTH_TOKEN` to Vercel. If it is absent,
  record retryable `SENTRY_BUILD_AUTH_TOKEN_MISSING` and finish through `resume:live`. Bind both
  DSN names, organization and project alongside the build token, protected by a plain
  idempotency-key ownership marker. Never persist or read back any token or DSN value.
- **Why:** Runtime event ingestion needs a public DSN, while private source-map/release uploads
  need a credential with materially different authority. Treating those as one ambient token
  widens application access and makes rotation ambiguous. Sentry's
  [regional API contract](https://docs.sentry.io/api/) identifies `de.sentry.io` as the Germany
  region; its [project creation endpoint](https://docs.sentry.io/api/projects/create-a-new-project/)
  and [client-key listing endpoint](https://docs.sentry.io/api/projects/list-a-projects-client-keys/)
  provide the reads and mutation needed for deterministic reconciliation. The two-phase boundary
  lets the project exist before a narrowly purposed build credential is supplied, while the
  generic atomic apply receipt preserves safe resume semantics.
- **Rejected alternatives:**
  - Reuse `SENTRY_API_TOKEN` as `SENTRY_AUTH_TOKEN`: couples provider administration to every
    application build and gives a leaked build secret broader authority than source-map upload
    requires.
  - Persist the public DSN in apply state because it is not an account secret: receipts are
    durable provenance, not runtime configuration; an opaque key ID and digest are sufficient to
    detect drift before rebinding.
  - Select the first client key returned by the API: list order is not an ownership contract and
    could silently bind a stale or additional key.
  - Accept a US organization through the global API hostname: violates the manifest's EU-primary
    operational intent and makes the region claim unobservable.
  - Repeat an ambiguous project create on resume: risks duplicating a mutation whose result is
    unknown; resume must reconcile only after an ambiguous create.
- **Acceptance evidence:** Provider-mocked contracts cover active-DE identity preflight, project
  creation and adoption, exact client-key selection, separate-token two-phase resume, Vercel
  ownership-marker reconciliation, ambiguous-create suppression, wrong-region rejection and
  absence of credentials/DSN values from persisted state. The isolated canary passed on 2026-07-27
  with plan `7cacd9647fd4dd1188fadb68ee783d0a144753589cedcbafa4e27622b59577e0`. It adopted the six
  existing provider resources, created DE project `4511807245516880`, paused before binding until
  the separate build token was available, then adopted Vercel marker `hHSyb6KDUXFU6K7I` on resume.
  Completed-state resume kept attempts `1,1,1,1,1,1,1,2`; fresh secret-free state adopted all eight
  IDs with one attempt each. Both receipts passed `doctor`, remained mode `0600`, and a dynamic
  comparison found none of the eight keyring credentials or the public DSN in either state file.
- **When to revisit:** Revisit the static build token when Sentry and Vercel expose a recoverable
  workload-identity or short-lived release-upload flow, when multi-key rotation becomes a product
  requirement, or when Sentry's regional API and Vercel secret semantics materially change.
