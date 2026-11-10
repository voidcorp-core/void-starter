---
date: 2026-07-27
title: "Provision private EU R2 storage inside the guarded provider lifecycle"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-27: Provision private EU R2 storage inside the guarded provider lifecycle

- **Date:** 2026-07-26
- **Decision:** Extend the deterministic provider plan with `cloudflare.r2-bucket` and, for a
  Vercel web surface, `vercel.r2-binding`. Keep only the 32-character Cloudflare account ID in the
  strict non-secret provisioning context. Read `CLOUDFLARE_API_TOKEN` and, when available,
  `R2_ACCESS_KEY_ID` plus `R2_SECRET_ACCESS_KEY` from process memory. Derive the bucket name from
  the exact project slug, require jurisdiction `eu` and storage class `Standard`, and send the
  jurisdiction header on every R2 request. Before adoption, reject enabled managed or custom
  public domains. Run one deterministic upload/read/delete object canary. If the runtime pair is
  absent, persist a retryable binding failure so the operator can issue credentials scoped to that
  exact bucket and finish with `resume:live`; otherwise bind the account, bucket, EU endpoint and
  runtime keys to Vercel with a plain idempotency-key ownership marker. Persist only the bucket ID,
  name, account ID, EU/private attestation, canary digest, binding marker ID and bound-key names.
- **Why:** The manifest already selects `cloudflare-r2-eu` for durable private documents, but an
  environment-variable scaffold does not prove that storage exists, remains in the EU, is private,
  accepts object I/O or reaches the deployed runtime. Cloudflare's
  [bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
  exposes an explicit `eu` jurisdiction, and its
  [public-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/list/)
  makes privacy observable before adoption. The object canary proves byte-level storage without
  leaving test data. Existing Vercel Sensitive/Development binding semantics and the generic
  atomic apply receipt preserve the same recovery and secret-handling boundary as Neon.
- **Rejected alternatives:**
  - Treat a location hint as EU residency: hints influence placement but do not provide the
    jurisdictional guarantee required by the manifest.
  - Trust default bucket privacy without reading domain state: a previously created bucket may
    have acquired a managed or custom public domain outside this plan.
  - Put Cloudflare or R2 credentials in the manifest/context/receipt: turns reproducible product
    intent and operational evidence into secret-bearing artifacts.
  - Generate a new R2 API token inside every apply: the secret value is shown only at creation,
    cannot be recovered during stateless adoption, and requires a broader token-management
    permission than bucket provisioning.
  - Repeat a timed-out bucket create on resume: risks duplicating or conflicting with a mutation
    whose outcome is unknown; resume must only reconcile after an ambiguous create.
- **Acceptance evidence:** The isolated canary passed on 2026-07-27 with plan
  `7a7be8babbdb8240ca34e7855bff008cf7f4302b85b0dbfd6797cd771afb0770`. It created the EU/private
  bucket `void-starter-canary-20260725` (`f520e89b2e934d96a7b4275140e122b7`), proved the exact object
  round trip and deletion, then paused until exact-bucket runtime credentials were available and
  adopted Vercel binding `ERMGEG72S7cCdvST`. A completed-state resume changed no attempt counter;
  a fresh secret-free local state adopted the same six provider IDs with one attempt each. The
  first real upload also exposed that Cloudflare's object endpoint requires a raw octet-stream
  body rather than multipart form data; the corrected contract is now enforced by the HTTP mock.
- **When to revisit:** Revisit credential generation when a recoverable workload-identity or
  short-lived credential flow can replace static R2 keys, or when the Cloudflare object API,
  jurisdiction guarantees or Vercel secret semantics materially change.
