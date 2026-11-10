---
date: 2026-07-24
title: "Isolate live provisioning behind account preflight and exact confirmation"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Isolate live provisioning behind account preflight and exact confirmation

- **Date:** 2026-07-24
- **Decision:** Implement the first authenticated adapter for GitHub repository, Vercel project,
  Neon project and Vercel database binding without changing the safe `apply` default. Expose
  authenticated reads through `preflight:live`; expose mutations only through the separate
  `apply:live` and `resume:live` commands with an exact project-name confirmation. Credentials
  come only from `GITHUB_TOKEN`, `VERCEL_TOKEN` and `NEON_API_KEY` in process memory. Every action
  uses lookup-before-create, validates matching resources before adoption and reconciles after a
  create. An ambiguous create becomes lookup-only on resume. The Neon connection URI is sent
  directly to write-only Vercel variables and never persisted: `sensitive` for Preview/Production
  and `encrypted` for Development, where Vercel does not support the sensitive type. A non-secret
  binding marker enables safe adoption. Generated web projects pin Functions to `fra1` in
  `apps/web/vercel.json`; the current Neon contract is `aws-eu-central-1`.
- **Why:** A valid token is insufficient proof that the factory is targeting the intended owner,
  team or organization. A successful or failed create response is also insufficient proof of
  remote state after transport ambiguity. Provider identity preflight and post-create
  reconciliation make the mutation target and retry behavior explicit. For organization-owned
  repositories, the exact GitHub membership endpoint requires `Members: read`; the broader
  no-permission membership listing returned an empty list during the sandbox canary, making it
  unreliable for exact owner validation. Vercel defaults Functions to `iad1` unless configured,
  while its documentation recommends locating Functions near the database. Neon documents POST
  as non-idempotent and exposes a safe project search endpoint.
  Sensitive Vercel environment variables are write-only for the factory, and regular encrypted
  values are not read back, so a separate non-secret marker is required for recovery. References:
  [GitHub repository API](https://docs.github.com/en/rest/repos/repos),
  [Vercel REST API](https://vercel.com/docs/rest-api),
  [Vercel Function regions](https://vercel.com/docs/functions/configuring-functions/region),
  [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables),
  [Neon list projects](https://api-docs.neon.tech/reference/listprojects), and
  [Neon connection URI](https://api-docs.neon.tech/reference/getconnectionuri).
- **Rejected alternatives:**
  - Reuse `apply --simulate` with a live flag: makes a typo capable of crossing the local/remote
    boundary.
  - Store tokens or `DATABASE_URL` in context or apply state: leaks credentials into durable
    project metadata.
  - Adopt a same-name resource without validating owner, visibility, framework, root directory or
    region: can attach the generated project to unrelated infrastructure.
  - Retry an ambiguous create after lookup misses once: eventual consistency can still turn that
    retry into a duplicate.
  - Read back Vercel's sensitive value to prove the binding: defeats the write-only secret
    boundary and is unsupported for sensitive variables.
- **When to revisit:** After a disposable sandbox-account run proves the current HTTP contracts.
  Then add repository push, migrations, deployment and smoke checks as new receipt-tracked actions
  rather than widening these resource-creation actions.
