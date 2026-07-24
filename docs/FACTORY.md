# Void Starter Factory

> Target architecture decided during the Forge discovery on 2026-07-24. This document captures
> the intended factory contract. It does not claim that the provisioning flow already ships.

## 1. Product boundary

Void Starter evolves from a repository that a developer clones and wires manually into a
manifest-driven project factory.

```text
Forge -> build manifest -> Void Starter Factory -> deployed project -> Void Harness
```

- Forge owns product intent, surfaces, capabilities, constraints, data policy and cost policy.
- Void Starter owns composition, provisioning, configuration, migration, deployment and receipt.
- Void Harness owns implementation discipline and ongoing project verification.

The current web starter remains the proven baseline. Optional surfaces and capabilities are added
only when selected by the manifest. An output repository must not contain unused mobile, worker,
analytics or payment scaffolding.

## 2. Desired outcome

After one approved `apply`, a project can be developed immediately with the selected parts of:

- GitHub repository;
- web and/or mobile app;
- database, migrations and seed;
- production-ready authentication;
- secrets and environment bindings;
- object storage and transactional email;
- observability and analytics;
- Vercel and EAS deployments;
- DNS records and domain verification;
- Linear project bootstrap;
- smoke tests and a machine-readable receipt.

No source code should contain a secret or require the developer to paste an environment variable
manually after generation.

## 3. Surface composition

```yaml
surfaces:
  web: next-vercel | none
  mobile: expo-eas | none
  worker: persistent-node | none
```

The factory source may support all surfaces. The generated repository contains only the selected
ones. A web-only project must not pay the complexity of Expo. A mobile project may live in the
same Turborepo and reuse domain logic, API contracts, auth client, validation and design tokens.

Expo is not copied from the current Solaar state. A new mobile surface starts from the current
stable Expo architecture, Hermes and EAS, with Swift/Kotlin modules only when a product capability
requires them. Exact versions are resolved and pinned at generation time.

## 4. API policy

tRPC is optional, not a universal dependency.

- Internal web mutations: Server Actions when they fit the boundary.
- Mobile or public API: REST/OpenAPI by default.
- Continuous bidirectional media: WebRTC or a workload-specific protocol.
- Server push: SSE when one-way delivery is enough.
- WebSocket: only when the state model genuinely requires it.

The protocol follows the product surface. The starter does not distort the product to preserve a
single RPC abstraction.

## 5. Workload routing

| Workload | Default | Escalation trigger |
|---|---|---|
| Next.js web, SSR, RSC | Vercel | Framework incompatible with Vercel |
| HTTP API and BFF | Vercel Functions | Persistent process or native runtime |
| Durable jobs and agent workflows | Vercel Workflows | Container, Python or specialized compute |
| Critical schedules | Vercel Cron -> idempotent Workflow | External scheduler required |
| Continuous voice | Client -> provider WebRTC | Provider constraint |
| Shared realtime state | Cloudflare Durable Objects EU | No shared state: do not provision |
| Always-on Node service | Render, then Fly for custom needs | No persistent workload: do not provision |

Vercel remains the center of gravity, not the universal runtime. Cloudflare is an approved second
provider. A third compute provider requires a concrete workload and an explicit plan.

## 6. Data and storage defaults

| Capability | Default |
|---|---|
| PostgreSQL | Neon EU + Drizzle |
| Private durable documents | Cloudflare R2 with EU jurisdiction |
| Simple app assets | Vercel Blob allowed |
| Strict WORM/legal hold | AWS S3 EU profile |
| Vector search at initial scale | pgvector in Neon |

Application code depends on project-owned ports such as `ObjectStorage`, not directly on a
provider throughout the codebase. Provider adapters must be replaceable without rewriting domain
services.

Private documents use immutable object keys, hashes and metadata in Postgres. Retention classes,
deletion workflows and locks are selected per data category. The factory never locks all personal
data indefinitely because durability and the right to erasure are separate concerns.

## 7. Authentication profiles

Better Auth remains the default. Clerk is an exception for time-critical B2B SSO or a product
whose identity requirements make the managed trade-off worthwhile.

```yaml
auth:
  provider: better-auth
  access_mode: public_verified
  passkeys: optional
  mfa: optional

  available_access_modes:
    - public_verified
    - invite_only
    - public_signup_gated_activation
```

The production baseline includes a real verification sender, password reset or magic-link flow,
enumeration protection, rate limiting and a deterministic seed/bootstrap path. A starter is not
turnkey while production email throws or an administrator must be promoted manually in SQL.

## 8. EU data policy

The default is `eu_primary`, not the misleading promise that a provider choice alone makes a
project GDPR compliant.

```yaml
data_residency:
  policy: eu_primary
  personal_data: eu_required
  public_assets: global_allowed
  non_eu_processor:
    requires_approval: true
    requires_dpa: true
    requires_transfer_assessment: true
```

Factory enforcement includes:

- Vercel compute explicitly pinned to an EU region instead of its US default;
- Neon in a matching EU region;
- R2 and Durable Objects created with EU jurisdiction, not a best-effort location hint;
- private user responses marked non-cacheable globally;
- telemetry redaction and no business payload in logs;
- a generated subprocessor and data-flow inventory for relevant profiles.

## 9. DNS and domains

Gandi can remain registrar. Cloudflare DNS is the recommended default for new projects, while
Gandi LiveDNS and Vercel DNS remain supported adapters.

The factory detects the authoritative provider and plans records for Vercel, email, auth and
storage. Nameserver changes always require explicit approval. Every DNS mutation has a preflight,
verification and recovery note.

## 10. Manifest

```yaml
schema_version: 1

project:
  name: example
  profile: saas

surfaces:
  web: next-vercel
  mobile: none

workloads:
  http: vercel-functions
  durable_jobs: vercel-workflows
  realtime_audio: none
  persistent_service: none

data:
  database: neon-eu
  orm: drizzle
  auth: better-auth
  files: cloudflare-r2-eu

operations:
  errors: sentry
  analytics: posthog
  email: resend

dns:
  provider: auto-detect

cost_policy:
  automatic_monthly_limit_eur: 10
  paid_upgrade_requires_approval: true
```

The manifest contains capability intent and references to secret bindings, never secret values.
Every schema version has migrations and a compatibility policy.

## 11. Lifecycle

```text
plan
  -> resolve profile and providers
  -> show resources, cost, permissions and DNS mutations

apply
  -> create GitHub and provider resources
  -> bind environments and secrets
  -> migrate and seed
  -> deploy and smoke-test

resume
  -> continue safely after interruption
  -> reuse confirmed opaque provider IDs

doctor
  -> verify source, auth, DB, DNS, deployments and selected capabilities

receipt
  -> persist IDs, URLs, versions, cost decisions, checks and next actions
```

Every external step is idempotent. The factory stores opaque provider IDs and never derives or
invents them. Destructive rollback is separate from retry and requires explicit approval.

## 12. Cost policy

Existing paid Vercel is treated as a sunk platform choice. Neon, Resend, Sentry and PostHog start
on suitable free tiers where they meet the product need. Cloudflare or another paid capability is
added when its benefit is explicit. The approximate automatic incremental budget is 10 EUR/month;
crossing it requires approval. The factory never upgrades a plan automatically.

## 13. Validation matrix

The factory is not complete until generated outputs are tested as fixtures. Minimum profiles:

- web public SaaS;
- web invite-only internal tool;
- web + Expo mobile;
- durable jobs;
- EU private documents;
- voice/realtime control plane;
- no optional modules.

Each fixture must install, type-check, migrate, seed, build and pass smoke tests. Provisioning
adapters use contract tests and dry-run fixtures; live canaries cover the provider APIs that cannot
be proven locally.

## 14. Implementation order

1. Freeze and test the current web baseline.
2. Define and validate manifest schema v1.
3. Implement deterministic local composition with fixture matrix.
4. Implement `plan`, receipt and `doctor` before external mutations.
5. Add GitHub, Vercel and Neon provisioning.
6. Finish Better Auth production onboarding and seed.
7. Add optional Expo/EAS surface.
8. Add R2, Resend, observability and DNS adapters.
9. Add `resume` and failure injection tests.
10. Connect Forge as manifest producer and Linear as project bootstrap.

## 15. Open decisions

- CLI/package name and distribution model.
- Secret binding model across local, Vercel, EAS and GitHub Actions.
- Exact provider rollback guarantees.
- Expo/React version alignment policy in the workspace.
- Boundary between generated code, overlays and post-generation transformations.
- Linear ownership: Forge creates product intent and backlog; Harness should update execution.
