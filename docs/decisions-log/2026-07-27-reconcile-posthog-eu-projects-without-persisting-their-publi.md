---
date: 2026-07-27
title: "Reconcile PostHog EU projects without persisting their public project key"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-27: Reconcile PostHog EU projects without persisting their public project key

- **Date:** 2026-07-27
- **Decision:** Extend the deterministic provider plan with `posthog.project` and
  `vercel.posthog-binding` whenever a Next.js surface selects PostHog analytics. Keep only the
  exact organization ID and literal `eu` region in the strict non-secret context. Use a
  process-memory `POSTHOG_PERSONAL_API_KEY` limited to `organization:read`, `project:read` and
  `project:write` against `eu.posthog.com`. Perform paginated exact-name lookup before create,
  reconcile after create, and suppress every repeated mutation after an ambiguous response.
  Persist only project/organization identity, the EU attestation and a SHA-256 of `api_token`.
  Re-read the exact project and verify that digest before binding encrypted
  `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST=/ingest` values to every Vercel target.
  Protect the binding with a plain `VOID_STARTER_POSTHOG_BINDING_ID` ownership marker. Validate
  provider IDs as exact UUID-shaped lowercase hexadecimal strings, without imposing RFC
  version/variant bits that PostHog Cloud does not consistently emit.
- **Why:** PostHog's
  [official EU OpenAPI contract](https://eu.posthog.com/api/schema/swagger-ui/) exposes
  organization reads and organization-scoped project list/create/retrieve endpoints with the
  three selected scopes. The project `api_token` is intended for client ingestion, but a receipt
  still needs only enough evidence to detect drift; its digest plus the recoverable provider ID is
  sufficient. Reusing the existing first-party `/ingest` proxy preserves ADR 28's EU upstream,
  CSP and blocker-resistance contract without adding a direct third-party browser origin. The
  same atomic receipt and lookup-only ambiguity boundary already proven for Neon, R2 and Sentry
  makes both completed-state resume and secret-free stateless adoption deterministic.
- **Rejected alternatives:**
  - Persist `api_token` because it is public: receipts are provenance, not runtime configuration,
    and storing the raw key adds no reconciliation capability beyond its digest.
  - Bind `https://eu.i.posthog.com` directly: bypasses the selected `/ingest` first-party proxy and
    weakens the runtime privacy/CSP contract.
  - Trust the OpenAPI `format: uuid` constraint literally: the live EU organization ID
    `019d9316-714e-0000-01c7-e9a08d38242b` is UUID-shaped but has neither RFC version nor variant
    bits; rejecting the provider's own ID prevents safe preflight and adoption.
  - Select the first search result or ignore pagination: either can adopt a similarly named or
    hidden later-page project instead of the one exact resource.
  - Repeat a timed-out project or binding create: risks duplicate projects or unowned Vercel
    variables when the provider accepted the first mutation.
- **Acceptance evidence:** Provider-mocked contracts cover EU organization preflight, project
  creation/adoption, paginated exact matching, key-digest verification, Vercel ownership
  conflicts, project and binding ambiguity suppression, and absence of credentials/project keys
  from state. The isolated canary passed on 2026-07-27 with plan
  `9d7a61823147d36f96447c98243cf0a8cab052f00b4e2b9b4e516b6c0a691617`. It adopted the eight
  historical provider resources, created PostHog project `233588`, exposed the UUID-format
  mismatch during reconciliation, then resumed by adopting that exact project without a second
  create and bound Vercel marker `KHP1Sghuyxh0KK7M`. Completed-state resume kept attempts
  `1,1,1,1,1,1,1,1,2,1`; a fresh state adopted all ten IDs with one attempt each. Both receipts
  passed `doctor`, remained mode `0600`, and a dynamic comparison found none of nine provider
  credentials, the Sentry DSN or the PostHog project key.
- **When to revisit:** Revisit the static personal key when PostHog offers recoverable short-lived
  workload identity for project administration, when the provider normalizes its organization IDs
  to RFC UUIDs, or when its project and environment API model changes materially.
