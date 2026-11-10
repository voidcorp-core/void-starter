---
date: 2026-08-04
title: "Resolve the R2 host from the binding, and carry the jurisdiction when composing it"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-08-04: Resolve the R2 host from the binding, and carry the jurisdiction when composing it

- **Date:** 2026-08-02
- **Decision:** `resolveR2Endpoint` returns `R2_ENDPOINT` whenever it is set, because the
  provisioning binds it and it already carries the jurisdiction. Only without it does the module
  compose the host from `CLOUDFLARE_ACCOUNT_ID`, and then it inserts `R2_JURISDICTION` as a host
  segment unless that value is `default`. Both variables are optional in the module's env schema,
  since a bucket in the default jurisdiction has neither.
- **Why:** A bucket created with a jurisdiction answers on the matching host only --
  `<account>.eu.r2.cloudflarestorage.com` for an EU one. The default host refuses it with
  credentials that are perfectly valid, so every presigned URL the module handed out named a host
  that would not serve the bucket, and ADR 68's direct-upload flow was dead on arrival for exactly
  the buckets the profile exists to serve. What makes it worth an entry rather than a patch is the
  symptom: the browser reports the refusal as a missing `Access-Control-Allow-Origin`, because a
  host that will not serve a bucket will not describe its CORS policy either. The failure names the
  wrong cause and keeps naming it however many origins are added to the rule. In `void-music` that
  cost a CORS rule edited on Cloudflare, a documentation paragraph and a commit message, all
  against a cause that was not the cause; the rule had been correct the whole time.
- **Rejected alternatives:**
  - Requiring `R2_ENDPOINT` unconditionally: correct for anything the factory provisions, and it
    would have made the bug unreachable, but it fails a bucket created by hand outside the factory
    for a reason the operator cannot infer from the message.
  - Hardcoding the `eu.` prefix to match the profile: the module would then be unusable against any
    other jurisdiction, including the default one, for a saving of one optional variable.
  - Deriving the jurisdiction from the bucket by probing both hosts at startup: two network calls
    on a cold path to recover a value the caller already knows.
- **Acceptance evidence:** Three cases in `storage.helper.test.ts`, written red before the
  implementation: the binding wins, the jurisdiction is composed in, and `default` composes the
  plain host. Live proof came from `void-music`, whose `documents.spec.ts` passed end to end for
  the first time against a real EU bucket -- authorize, PUT, confirm, list, download, erase.
- **When to revisit:** The provisioning binds `R2_ENDPOINT` for every bucket it creates, so the
  compose path is only ever load-bearing outside the factory. If that stops being true, the
  adapter should assert the binding exists for a jurisdiction-created bucket rather than let a
  silently composed host be the thing that carries the flow.
