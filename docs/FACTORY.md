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

Void Harness remains external development tooling. The factory may use it while building and
verifying Void Starter, but it never copies Harness files, hooks, skills, configuration or package
dependencies into a generated repository.

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
  mobile:
    adapter: expo-eas | none
    ios_bundle_identifier: com.example.product # required for expo-eas
    android_package: com.example.product       # required for expo-eas
  worker: persistent-node | none
```

The factory source may support all surfaces. The generated repository contains only the selected
ones. A web-only project must not pay the complexity of Expo. A mobile project may live in the
same Turborepo and reuse domain logic, API contracts, auth client, validation and design tokens.
Development-only factory and Harness tooling are excluded from every generated output as well.

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
| Durable jobs and agent workflows | Vercel Workflows (US `iad1` backend, see section 8) | Container, Python or specialized compute |
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
```

The available access modes are `public_verified`, `invite_only`, and
`public_signup_gated_activation`.

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
  approved_non_eu_processors: []
  non_eu_processor:
    requires_approval: true
    requires_dpa: true
    requires_transfer_assessment: true
```

`approved_non_eu_processors` is where the approval demanded by `non_eu_processor` is actually
recorded. It is optional and empty by default, and it is not decoration: a workload whose provider
stores data outside the EU is rejected unless it is named there, and an approval no selected
workload requires is rejected too, so dead approvals cannot accumulate (ADR 62).

Today the only such processor is `vercel-workflows`. The Vercel World stores workflow run data in
`iad1` whatever the deployment region, so selecting `workloads.durable_jobs: vercel-workflows` on an
`eu_primary` project is a transfer outside the EU. Payloads are encrypted end to end with a per-run
key, and the job payload contract carries only opaque references while personal data stays in Neon
EU, but neither removes the transfer. The approval must be a deliberate, versioned decision, which
is also what forces Forge to put the question to a human rather than resolve it silently.

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

The implemented factory slice lives in `tooling/factory`. It validates schema v1 with strict Zod
objects, produces a deterministic ordered composition plan, previews a sorted local file plan, and
can render the selected surfaces into a new directory. The Expo blueprint targets SDK 57, React
Native 0.86, Expo Router, and EAS. The EAS configuration is generated, while its pinned CLI runs
on demand and does not inflate the application lockfile. `eas:plan|preflight|live|resume` creates
or adopts the exact EAS project without starting a native build. Rendering remains local. A
separate provisioning plan models the first GitHub, Vercel and Neon resource tranche. Dry-run and
simulation remain the safe defaults; authenticated execution is isolated behind separate live
commands.

```yaml
schema_version: 1

project:
  name: example
  profile: saas

surfaces:
  web: next-vercel
  mobile:
    adapter: none
  worker: none

workloads:
  http: vercel-functions
  durable_jobs: vercel-workflows
  realtime_audio: none
  persistent_service: none

data:
  database: neon-eu
  orm: drizzle
  files: cloudflare-r2-eu

auth:
  provider: better-auth
  access_mode: public_verified
  passkeys: optional
  mfa: optional

operations:
  errors: sentry
  analytics: posthog
  email: resend

data_residency:
  policy: eu_primary
  personal_data: eu_required
  public_assets: global_allowed
  # Required because durable_jobs is selected above: the Vercel World stores run
  # data in iad1 whatever the deployment region. See section 8.
  approved_non_eu_processors:
    - vercel-workflows
  non_eu_processor:
    requires_approval: true
    requires_dpa: true
    requires_transfer_assessment: true

dns:
  provider: auto-detect

cost_policy:
  automatic_monthly_limit_eur: 10
  paid_upgrade_requires_approval: true
```

The manifest contains capability intent and references to secret bindings, never secret values.
Every schema version has migrations and a compatibility policy.

The current surface fixture matrix is executable without mutation:

```sh
cd tooling/factory
bun run plan -- fixtures/manifests/web-only.yaml
bun run plan -- fixtures/manifests/web-minimal.yaml
bun run plan -- fixtures/manifests/web-clerk.yaml
bun run plan -- fixtures/manifests/mobile-only.yaml
bun run plan -- fixtures/manifests/web-expo.yaml
```

Selecting `expo-eas` requires explicit iOS and Android identifiers. The factory never derives an
application identity from a company name it was not given.

Local generation always targets a new directory:

```sh
cd tooling/factory
bun run generate -- fixtures/manifests/web-expo.yaml /absolute/path/to/new-project
bun run doctor -- /absolute/path/to/new-project

cd /absolute/path/to/new-project
git init
bun install
bun run hooks:install
```

### 10.1 Forge Project Pack injection

Forge can also produce `forge/project-pack-v1`, a deterministic set of 14 product foundation
documents. This contract is consumed after local generation, or against an existing project. It
does not select surfaces, modify the build manifest, or provision remote resources.

```sh
cd tooling/factory
bun run foundation -- preview \
  /absolute/path/to/project/.forge/project-pack/manifest.yaml \
  /absolute/path/to/project

bun run foundation -- apply \
  /absolute/path/to/project/.forge/project-pack/manifest.yaml \
  /absolute/path/to/project \
  --confirm-project exact-project-id

bun run foundation -- check \
  /absolute/path/to/project/.forge/project-pack/manifest.yaml \
  /absolute/path/to/project
```

The adapter validates the external contract, every source content hash, all path boundaries, and
the previous per-file receipt. Its merge policy is strict:

- first write is create-only;
- a managed destination can update only when its current hash matches the previous receipt;
- a missing, locally modified, symlinked, or unmanaged destination is a conflict;
- one conflict blocks all 14 writes;
- apply requires the exact Forge project id;
- the canonical receipt lives at `.void-starter/project-pack-receipt.json`;
- preview and check are non-mutating.

The local Zod boundary is a consumer compatibility mirror, not ownership of the Forge schema.
Contract drift is tested against real Forge output before a revision is accepted. A shared schema
package remains premature until the ecosystem reaches the extraction thresholds documented by
Forge.

The generator fails if the target exists or is inside the source repository. It rejects source
symlinks and excludes `.git`, `.env*` secrets, caches, build outputs, the source lockfile, factory
code, Harness state, agent-governance artifacts, internal discovery handoffs and historical
implementation plans. The output stores the normalized manifest and a deterministic receipt under
`.void-starter/`. `doctor` recalculates the plan and SHA-256 digests, checks surface and local
capability presence, scans package manifests and a newly generated lockfile for Harness
dependencies, and fails closed on invalid metadata.

Local capability composition currently handles:

- a public minimal web app with auth, DB, sample notes, PostHog and Sentry fully removed;
- Better Auth with Neon/Drizzle and the notes reference domain;
- Clerk as a direct Next.js integration, without copying its documentation scaffold;
- PostHog, Sentry and Resend package/configuration overlays;
- mobile-only pruning of every Next.js-only package.

The selected capability set also produces a deterministic `.env.example`; it contains placeholders
only, never secret values. Better Auth, Clerk, PostHog, Sentry, Resend and DNS are currently web
adapters, so selecting them without a Next.js surface is rejected. R2, Sentry, PostHog and an
explicit Cloudflare DNS context have guarded live provider adapters. DNS remains non-mutating
provider intent when `auto-detect` has no explicit context. Resend's local adapter is materialized
while its remote account/domain and secret binding remain a later lifecycle.

### 10.2 Provisioning context

Provider account coordinates are intentionally separate from the product manifest:

```yaml
schema_version: 1

github:
  owner: voidcorp-core
  owner_kind: organization
  visibility: private

vercel:
  team_id: team_example
  region: fra1

neon:
  org_id: org-example
  region_id: aws-eu-central-1

cloudflare:
  account_id: 0123456789abcdef0123456789abcdef

sentry:
  organization_slug: void-sandbox
  team_slug: platform
  region: de

posthog:
  organization_id: 019d9316-714e-0000-01c7-e9a08d38242b
  region: eu

dns:
  provider: cloudflare
  account_id: 0123456789abcdef0123456789abcdef
  zone_id: fedcba9876543210fedcba9876543210
  zone_name: example.com
  hostname: example-saas.example.com
```

This strict document accepts no credentials. Owner, team and organization IDs are explicit so the
factory never derives or invents opaque provider identity. The first live contract fixes Vercel
to `fra1` and Neon to `aws-eu-central-1`. Generated web projects contain
`apps/web/vercel.json`, so Vercel Functions do not silently fall back to the `iad1` default. The
optional DNS block resolves manifest `auto-detect` intent to one exact Cloudflare zone and a strict
subdomain; without it, auto-detect performs no DNS mutation.

After generating a project:

```sh
cd tooling/factory

# Safe default: prints the plan and writes nothing.
bun run apply -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --dry-run

# Exercises state, locking and resume locally; it never calls provider APIs.
bun run apply -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --simulate

bun run resume -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --simulate
```

The plan is deterministic and each action receives a content-derived idempotency key. Simulation
stores a canonical `.void-starter/apply-state.json` after every transition using an atomic rename.
A process lock prevents concurrent applies; a lock owned by a process that no longer exists is
recovered. Resume verifies the manifest and complete plan digest, rejects drift, skips successful
actions and retries the first incomplete action. Persisted failures contain only explicit safe
diagnostics, not raw provider errors that could contain credentials.

The action vocabulary uses `ensure-*` reconciliation semantics. This is especially important for
Neon: its create-project endpoint warns that retrying a timed-out `POST` can create more than one
project. A future live adapter must search by its stable ownership metadata before creating, then
persist the returned opaque provider ID before advancing. See the official
[Neon create-project contract](https://api-docs.neon.tech/reference/createproject),
[GitHub repository endpoint](https://docs.github.com/en/rest/repos/repos) and
[Vercel REST API authentication/team routing](https://vercel.com/docs/rest-api).

### 10.3 Live provider boundary

The authenticated adapter covers GitHub repository, Vercel project, Neon project, the Vercel
`DATABASE_URL` binding, a private EU-jurisdiction Cloudflare R2 bucket and its Vercel runtime
binding, a DE Sentry project and its Vercel runtime/build binding, plus an EU PostHog project and
its Vercel runtime binding. An explicit DNS context also adds the exact Vercel project domain and
one owned Cloudflare CNAME. Credentials exist only in process memory:

```sh
export GITHUB_TOKEN=...
export VERCEL_TOKEN=...
export NEON_API_KEY=...
export CLOUDFLARE_API_TOKEN=...
export SENTRY_API_TOKEN=...
export POSTHOG_PERSONAL_API_KEY=...

bun run preflight:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml
```

The preflight performs only authenticated reads. It verifies the GitHub user or active
organization membership, exact Vercel team ID, accessible Neon organization ID, accessible
Cloudflare R2 account/jurisdiction, an active Sentry organization in `de.sentry.io` with access to
the exact team, and the exact PostHog organization through `eu.posthog.com`. It creates no state
and performs no mutation. DNS preflight reads the exact Cloudflare zone and requires the account,
name, active status and primary/partial setup to match. For an organization owner, the
fine-grained GitHub token requires
`Organization permissions > Members: Read-only` so the factory can verify the exact membership
through `GET /user/memberships/orgs/{org}`. Personal-account owners do not require this permission.

The mutation command is deliberately separate and requires an exact project-name confirmation:

```sh
bun run apply:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo

bun run resume:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

Every provider resource is looked up before creation and validated before adoption. Each create is
followed by another lookup rather than trusting an incomplete response. If a network failure or
server error makes a create ambiguous, state records an explicit ambiguity code. Subsequent
resume attempts perform lookup only and never issue a second create for that action.

For the database binding, the adapter retrieves a pooled Neon URI into memory. It posts the URI to
Vercel as `sensitive` for Preview/Production and as `encrypted` for Development, because Vercel
does not permit sensitive variables in Development. Neither value is read back. The URI, access
tokens and provider response bodies never enter `.void-starter/apply-state.json`. A plain
`VOID_STARTER_DATABASE_BINDING_ID=<action-idempotency-key>` marker proves binding ownership
without exposing `DATABASE_URL`; a pre-existing unmarked binding fails closed.

For R2, the bucket name is the exact project slug and the plan fixes jurisdiction `eu` and storage
class `Standard`. Creation and lookup send `cf-r2-jurisdiction: eu`; adoption fails if the bucket
differs or if either its managed `r2.dev` domain or a custom domain is enabled. A deterministic
canary uploads, reads byte-for-byte and deletes one isolated object. The adapter then binds
`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT` and
`R2_SECRET_ACCESS_KEY` to Vercel. Runtime credentials use Sensitive Preview/Production variables
and encrypted Development variables. `VOID_STARTER_R2_BINDING_ID` proves exact ownership; local
state stores only opaque IDs, the EU/private attestation and the canary payload digest.

The first live apply may intentionally omit the R2 runtime pair. It creates and validates the
bucket, then records a retryable `CLOUDFLARE_R2_RUNTIME_CREDENTIAL_MISSING` failure before the
Vercel binding. The operator can then issue Object Read & Write credentials scoped to the now
existing bucket and provide `R2_ACCESS_KEY_ID` plus `R2_SECRET_ACCESS_KEY` to `resume:live`.
Resume skips the completed bucket action and binds only the least-privilege runtime credentials;
providing one value without the other fails before provider calls.

For Sentry, the plan fixes region `de`, platform `javascript-nextjs`, exact organization/team slugs
and default issue-alert rules. `SENTRY_API_TOKEN` is the control credential used for authenticated
preflight and lookup-before-create. Adoption requires the exact active project, platform and team,
plus exactly one active client key. Local state keeps only the project/key IDs and a SHA-256 of the
public DSN. The DSN itself is re-fetched into memory when binding and must still match that digest.

`SENTRY_BUILD_AUTH_TOKEN` is a separate optional release-upload credential. If absent, the project
can complete while `vercel.sentry-binding` records retryable
`SENTRY_BUILD_AUTH_TOKEN_MISSING`; `resume:live` then binds `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`. The auth token is
Sensitive for Preview/Production and encrypted for Development. A plain
`VOID_STARTER_SENTRY_BINDING_ID` marker proves ownership without persisting any secret value.

For PostHog, the strict context fixes region `eu` and the exact organization ID. The personal
control key requires only `organization:read`, `project:read` and `project:write`. Lookup searches
every result page for one exact project name before any create, and ambiguous creates are never
repeated. State stores the project ID, organization/name/region attestation and only a SHA-256 of
the public project key. The key is re-read and matched to that digest before Vercel receives
encrypted `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST=/ingest` values for all three
targets. A plain `VOID_STARTER_POSTHOG_BINDING_ID` marker proves binding ownership. PostHog Cloud
currently returns organization IDs in a UUID-shaped 36-character hexadecimal form that does not
always carry an RFC UUID version/variant, so validation follows the observed provider contract
without accepting arbitrary strings.

For DNS, the context must name a strict subdomain of the explicit Cloudflare zone. The plan fixes
the record to CNAME, DNS-only, TTL 60, zero estimated monthly cost and no nameserver change. It
first attaches the hostname to the exact Vercel project, reads the current rank-1 recommended
CNAME through Vercel's domain-configuration API, then creates the Cloudflare record with the
action idempotency key in its comment. Any Vercel TXT ownership challenge is created with its own
owned comment before verification. Success requires an exact owned Cloudflare readback, a verified
Vercel project domain and `misconfigured=false`. Propagation pending is retryable and resume never
repeats a domain or DNS create whose result was ambiguous. Unmarked or drifted records fail
closed. A known paid-upgrade response becomes `VERCEL_PAID_UPGRADE_APPROVAL_REQUIRED`; the adapter
never buys a domain, changes a subscription or mutates nameservers. Automated rollback stops at
the provider boundary: the documented manual order is owned DNS records first, project-domain
attachment second.

The live adapter is covered by HTTP contract mocks, secret-persistence assertions, adoption tests,
identity/privacy/region mismatch tests and ambiguous-create resume tests. The original
isolated-account canary created the GitHub/Vercel/Neon tranche once, kept its IDs on
completed-state resume and adopted it from a fresh local state without duplication. On
2026-07-27, plan
`7a7be8babbdb8240ca34e7855bff008cf7f4302b85b0dbfd6797cd771afb0770` extended that proof to R2:
the EU/private bucket `void-starter-canary-20260725` (`f520e89b2e934d96a7b4275140e122b7`)
passed the object round trip, Vercel adopted binding `ERMGEG72S7cCdvST`, completed-state resume kept
all attempt counters unchanged, and a fresh state adopted the same six resources with one attempt
per action. Both state files remained mode `0600` and secret-free.

The Sentry canary then passed with plan
`7cacd9647fd4dd1188fadb68ee783d0a144753589cedcbafa4e27622b59577e0`. It adopted those same six
resources, created DE project `4511807245516880`, selected client key
`55f31207fd9b8307ee94f6a34bd79741`, stopped at the expected missing-build-token boundary, and
resumed to Vercel binding `hHSyb6KDUXFU6K7I`. A completed-state resume preserved attempt counters
`1,1,1,1,1,1,1,2`; a fresh local state adopted the same eight IDs with one attempt each. Both
receipts passed `doctor`, remained mode `0600`, and matched none of the eight provider credentials
or the public DSN.

The PostHog canary passed with plan
`9d7a61823147d36f96447c98243cf0a8cab052f00b4e2b9b4e516b6c0a691617`. It adopted those same eight
resources, created EU project `233588`, and bound Vercel marker `KHP1Sghuyxh0KK7M`. The first
reconciliation exposed the non-RFC organization-ID shape described above; after tightening the
provider-specific validator, resume adopted the already-created project instead of issuing a
second create. Completed-state resume preserved attempts `1,1,1,1,1,1,1,1,2,1`; a fresh local
state adopted the same ten IDs with one attempt each. Both receipts passed `doctor`, remained mode
`0600`, and matched none of the nine provider credentials, Sentry DSN or PostHog project key.

The cross-provider replay for DEV-471 then adopted all ten GitHub, Vercel, Neon, R2, Sentry and
PostHog actions in one attempt each without a DNS context. It published source digest
`8fdb9f6b11d23cc2af72eff570c13e22d8a31c185662d0d575b8ca7bcec84f6e` at commit
`b72382505f6205d7e24a90a1b30970ca88fa604c`, verified four applied Neon migrations with zero
pending, and smoked the exact READY Vercel Production deployment in HTTP 200 through the stored
automation bypass. The generated application passed lint, type-check, tests, Knip, Next.js build
and Expo iOS/Android/Web exports; GitHub Actions run `30279121369` passed both quality and E2E on
the same source commit. This replay exposed and fixed a dynamic Expo configuration
boundary: tools may load `app.config.ts` without pre-merging `app.json`, so the generated loader
now falls back to the validated static Expo config before applying the receipt-owned EAS link.
The fresh target then adopted the same EAS project in one attempt under plan
`27b4ffa2428f2e6c4b2eae26f5eddb08976a5df1c467eaf4ac12167aa9e2230c`. Its public link remained
byte-identical while the new operational receipt bound dynamic-config digest
`ce347db34067c06fd55aeee520b5886c100ece2562cc601a767a0d3ed4383c44`; no additional source push
was required and the final `doctor` passed every lifecycle check.

### 10.4 Initial source publication

Initial source publication is a separate receipt and lock boundary, so adding it does not
invalidate or widen a completed infrastructure plan. It requires a successful live provisioning
state and a generated `bun.lock`:

```sh
bun run source:plan -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml

GITHUB_TOKEN=... bun run source:preflight -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml

GITHUB_TOKEN=... bun run source:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

The plan hashes the exact publishable file set. Local apply/source receipts, `.env*` values,
caches, build output, per-user Claude state and Git metadata are excluded. Symlinks, credential
files and missing lockfiles fail before authenticated requests. The commit uses the authenticated
GitHub user's noreply identity so connected Vercel Pro projects can recognize its author.

The token reaches Git only through a temporary askpass process environment. Credential helpers
are disabled, the configured origin never contains a token, and the helper is deleted after the
push. A source SHA-256 marker and exact Git tree SHA protect adoption. A pre-existing unmarked or
different `main` branch fails closed; an ambiguous push is looked up before resume. State is
written atomically to `.void-starter/source-state.json`, which is ignored by Git and contains no
credential.

Factory-owned revisions remain a separate explicit command:

```sh
GITHUB_TOKEN=... bun run source:update:preflight -- \
  /absolute/path/to/fresh-updated-project \
  fixtures/provisioning/eu.yaml

GITHUB_TOKEN=... bun run source:update:live -- \
  /absolute/path/to/fresh-updated-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

The fresh target must first adopt the existing provider resources. Update preflight accepts only
an existing remote HEAD with a valid Void Starter source marker. Live update fetches and verifies
that exact commit and tree, creates a single child commit, rechecks the HEAD for races, and uses a
normal fast-forward push. It never force-pushes or adopts an unmarked/user-modified HEAD.
`source:update:resume` reconciles a transport-ambiguous update without creating another commit.
If GitHub briefly returns the old exact base after a successful push, the lifecycle records
`GITHUB_SOURCE_PUSH_UNCONFIRMED` as retryable instead of misclassifying eventual consistency as a
source conflict; resume then adopts the already-published child commit.

GitHub permits personal access tokens in place of HTTPS passwords:
[GitHub PAT command-line authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
Vercel automatically deploys pushes to a connected repository and detects the package manager
from the root lockfile:
[Vercel Git deployments](https://vercel.com/docs/git) and
[Vercel monorepos](https://vercel.com/docs/monorepos).

### 10.5 Exact Neon schema migration

Schema migration has its own plan, receipt and lock boundary. It requires valid live provisioning
and source-publication state, then binds the exact source commit and digest to the provisioned Neon
project/database identity and every journaled Drizzle SQL hash and timestamp:

```sh
bun run migration:plan -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

NEON_API_KEY=... bun run migration:preflight -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

NEON_API_KEY=... bun run migration:live -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

Preflight performs authenticated Neon reads, retrieves a direct connection URI into process
memory, and reads only `drizzle.__drizzle_migrations`. An existing history must be the exact prefix
of the published plan; extra, reordered or changed migrations fail closed. Live execution holds a
local process lock plus a PostgreSQL advisory lock, applies pending migrations through Drizzle's
transactional migrator, and re-reads the complete history before success. Statement and lock
timeouts bound blocked executions; `migration:resume` safely re-inspects after an unconfirmed
attempt.

`.void-starter/migration-state.json` stores the project/database IDs, counts, latest tag/hash and
verification timestamp, never `NEON_API_KEY` or the connection URI. It is written mode `0600`,
excluded from source publication and validated by `doctor`. This follows Neon's
[connection URI](https://api-docs.neon.tech/reference/getconnectionuri) contract and Drizzle's
[applied migration log](https://orm.drizzle.team/docs/drizzle-kit-migrate).

The lifecycle does not invent seed data. A production administrator bootstrap needs an explicit
product identity and belongs to Better Auth onboarding; separating it prevents schema readiness
from silently creating a user with guessed credentials or privileges.

The isolated sandbox canary started from an empty Drizzle history, applied all four published SQL
migrations in one attempt, and re-read the exact final history through
`drizzle.__drizzle_migrations`. The receipt passed `doctor`, retained mode `0600`, and left the
publishable source digest unchanged.

### 10.6 Deployment observation and HTTP smoke

Deployment verification is a separate receipt and lock boundary. Its local plan requires valid
live provisioning and source-publication state, then binds the exact published commit and source
SHA-256 to the opaque Vercel team/project IDs and Production target:

```sh
bun run delivery:plan -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

VERCEL_TOKEN=... bun run delivery:preflight -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

VERCEL_TOKEN=... VERCEL_AUTOMATION_BYPASS_SECRET=... \
  bun run delivery:live -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

Preflight performs authenticated Vercel reads only. Live observation polls Production deployments
for the exact Git commit, rejects deployments from any other commit, and waits for `READY`. It then
requests the immutable deployment root with redirects disabled, requiring HTTP 200, an HTML
content type and the generated project name in a response capped at 1 MiB.

Protected deployments use Vercel's `x-vercel-protection-bypass` header. The value comes only from
`VERCEL_AUTOMATION_BYPASS_SECRET`; it is never accepted in a manifest or context and never written
to disk. A missing or rejected bypass produces a safe retryable code, so `delivery:resume` can
continue after the operator configures the secret. The receipt stores only the deployment ID and
URL, exact commit, timestamps, status, response metadata and body SHA-256 in
`.void-starter/delivery-state.json`. See Vercel's
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
and [REST API](https://vercel.com/docs/rest-api) contracts.

The isolated sandbox canary resolved the exact published commit to a `READY` Production
deployment, crossed Vercel Authentication with the memory-only header, and received a 200 HTML
response containing the project identity. The resulting receipt passed `doctor`, retained mode
`0600`, and left the publishable source digest unchanged.

### 10.7 Production authentication binding and administrator bootstrap

Authentication configuration has its own plan, lock and receipt. It requires Better Auth with
`operations.email: resend`, successful live provisioning, exact source publication and completed
Neon migrations. Provider coordinates remain in the provisioning context; canonical URL, sender
and bootstrap identity live in a separate non-secret auth context:

```yaml
schema_version: 1

canonical_url: https://example-saas.example.com

email:
  from: Example SaaS <auth@mail.example.com>
  reply_to: support@example.com

bootstrap:
  administrator_email: owner@example.com
```

The runnable example is `tooling/factory/fixtures/auth/production.yaml`. The sender domain must be
verified in Resend first. The bootstrap email is normalized to lower case and bound into the plan;
the context contains no API key or authentication secret.

```sh
bun run auth:plan -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  fixtures/auth/production.yaml

VERCEL_TOKEN=... BETTER_AUTH_SECRET=... RESEND_API_KEY=... \
  bun run auth:preflight -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  fixtures/auth/production.yaml

VERCEL_TOKEN=... BETTER_AUTH_SECRET=... RESEND_API_KEY=... \
  bun run auth:live -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  fixtures/auth/production.yaml \
  --confirm-project web-expo
```

Preflight performs authenticated Vercel reads only. It rejects any managed variable that is not
owned by the exact plan. Live writes `BETTER_AUTH_SECRET` and `RESEND_API_KEY` as Production-only
Vercel Sensitive variables; canonical URLs, sender settings and
`AUTH_BOOTSTRAP_ADMIN_EMAIL` are encrypted Production variables. Preview is intentionally left
anonymous rather than sharing production authentication or database credentials. A non-secret
plan-digest marker permits lookup-before-create reconciliation because Sensitive values cannot be
read back.

After binding, the lifecycle sends one idempotent configuration email to the exact administrator.
This proves the Resend sending key and verified sender without creating a user. Better Auth grants
role `admin` only if that same identity is newly created later; no credentials or placeholder seed
are invented. `auth:resume` adopts already-owned variables before retrying the email, so a partial
provider failure does not duplicate the binding.

`.void-starter/auth-state.json` is atomic, mode `0600`, source-excluded and secret-free. It records
the bound variable IDs, email ID, bootstrap strategy and `requires_redeployment: true`. Vercel
environment changes apply only to a new deployment: redeploy Production, rerun the delivery smoke,
then test sign-up/verification or magic link with the exact administrator address.

The isolated live canary bound all eight Production variables, delivered the Resend configuration
email through a verified subdomain, redeployed the exact source commit and passed the protected
HTTP smoke. A real magic link then created the planned identity and `/admin` reported its role as
`admin`. The auth receipt remained mode `0600`, `doctor` stayed green and the publishable source
digest did not change.

### 10.8 Expo/EAS project provisioning

EAS project creation has its own local plan, lock and receipt. It requires an Expo/EAS mobile
surface and a strict non-secret context naming the Expo account:

```yaml
schema_version: 1
account: void-sandbox
```

```sh
bun run eas:plan -- \
  /absolute/path/to/generated-project \
  /absolute/path/to/eas-context.yaml

EXPO_TOKEN=... bun run eas:preflight -- \
  /absolute/path/to/generated-project \
  /absolute/path/to/eas-context.yaml

EXPO_TOKEN=... bun run eas:live -- \
  /absolute/path/to/generated-project \
  /absolute/path/to/eas-context.yaml \
  --confirm-project web-expo
```

Preflight invokes the pinned `eas-cli@21.2.0` only for authenticated account reads. It verifies
that the token can access the requested account with a non-viewer role; an existing local link is
also read back from EAS. Live execution creates or adopts the unique `@account/project-slug`
project with `project:init --force --non-interactive` inside an isolated temporary static config,
then verifies the resulting full name and UUID through `project:info`.

The generated `app.json` remains provider-neutral and covered by the immutable generation
receipt. A stable generated `app.config.ts` optionally reads
`apps/mobile/eas-project.json`, a publishable non-secret file containing only schema version,
owner, slug and EAS project ID. This controlled overlay makes the link available to future EAS
commands without rewriting generation-owned config. `.void-starter/eas-state.json` records the
exact plan, link digest and opaque project identity in mode `0600`; the token, CLI output and
temporary config are never persisted. `doctor` rejects a link without its valid operational
receipt and source publication excludes the receipt and lock.

If creation succeeds remotely but the CLI result is ambiguous, `eas:resume` repeats the same
owner/slug initialization. EAS adopts the unique existing project, so the lifecycle can finish the
receipt without issuing a second logical project. This tranche deliberately does not run
`eas build`, create signing credentials, enroll an Apple/Google developer account or submit to a
store. Those are separate cost- and credential-bearing actions. See Expo's
[programmatic access](https://docs.expo.dev/accounts/programmatic-access/) and
[EAS project initialization](https://github.com/expo/eas-cli#eas-init) contracts.

The isolated live canary created `@void-sandbox/void-starter-canary-20260725`, verified its UUID,
published the non-secret link through a guarded source fast-forward and passed the complete CI,
E2E, Vercel deployment and protected HTTP smoke chain. The canary also established that the
provider-owned temporary directory needs a minimal `package.json` and an identity-only Expo config:
copying runtime plugins into that dependency-free directory makes provider initialization depend
on modules that do not belong to the provisioning boundary. Failed CLI output is now redacted in
memory for operator diagnosis while persisted failures remain generic and secret-free.

### 10.9 Guarded EAS environments and native builds

Native builds are a separate cost- and credential-bearing lifecycle. Its strict, non-secret
context selects one generated EAS profile and one or two platforms, declares required variable
metadata, attests remote signing readiness and store memberships, and freezes an operator-approved
USD envelope. The reference fixture intentionally keeps signing unready, so it is safe to plan and
preflight but cannot start a build as-is:

```sh
bun run eas-build:plan -- \
  /absolute/path/to/generated-project \
  fixtures/eas/native-build.yaml

EXPO_TOKEN=... bun run eas-build:preflight -- \
  /absolute/path/to/generated-project \
  fixtures/eas/native-build.yaml
```

The plan requires the exact succeeded EAS-project and source-publication receipts and binds their
project UUID, source commit and digest to the immutable generated `apps/mobile/eas.json`. Preflight
reads the account, linked project, selected EAS environment and build history. It compares only
variable name, visibility and type; values are discarded and never enter output or receipts.
Signing readiness blocks every selected platform. Production builds additionally require an
active membership attestation for the corresponding Apple or Google Play store.

Once the non-secret attestations are true and the variables exist, live execution requires three
exact confirmations:

```sh
EXPO_TOKEN=... bun run eas-build:live -- \
  /absolute/path/to/generated-project \
  /absolute/path/to/eas-build-context.yaml \
  --confirm-project web-expo \
  --confirm-build-count 2 \
  --approve-max-charge-usd 25
```

The USD value is an explicit human approval boundary, not a provider-enforced spending cap. Each
platform is started separately with pinned `eas-cli@21.2.0`, `--freeze-credentials`,
`--non-interactive`, `--no-wait` and a unique plan-digest message. Automatic store submission is
never enabled. The message lets `eas-build:resume` adopt a build created before an ambiguous CLI
failure without paying for a duplicate. `.void-starter/eas-build-state.json` is atomic, mode
`0600`, source-excluded and secret-free; it remains `running` while builds are queued or active,
becomes `succeeded` only when every exact build is `FINISHED`, and is verified by `doctor`.

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

The local `generate` and `doctor` stages implement the source, surface, local-capability, receipt
and integrity parts of this lifecycle. `apply --dry-run` implements the deterministic first
provider plan, while `apply --simulate` and `resume --simulate` implement its local state machine.
The separate live commands implement the first GitHub/Vercel/Neon provider boundary. The source
commands implement guarded initial publication and fast-forward updates. Migration commands bind
and apply exact Drizzle history to Neon. Delivery commands implement exact-commit Vercel
observation and protected HTTP smoke verification. Production auth bootstrap is a separate
completed lifecycle. EAS commands create/adopt the mobile project and materialize its non-secret
source link; native builds remain explicit future actions.

## 12. Cost policy

Existing paid Vercel is treated as a sunk platform choice. Neon, Resend, Sentry and PostHog start
on suitable free tiers where they meet the product need. Cloudflare or another paid capability is
added when its benefit is explicit. The approximate automatic incremental budget is 10 EUR/month;
crossing it requires approval. The factory never upgrades a plan automatically.

## 13. Validation matrix

The executable local matrix currently installs, lints, runs Knip, type-checks, tests, builds and
doctors these profiles:

- public minimal web;
- Better Auth + Neon/Drizzle web;
- Clerk web;
- Expo mobile-only;
- Better Auth + PostHog + Sentry web and Expo;
- Better Auth + durable jobs web.

The remaining remote validation target includes:

- web invite-only internal tool;
- EU private documents;
- voice/realtime control plane;
- provisioned provider smoke tests.

Each fixture must install, type-check, migrate, seed, build and pass smoke tests. Provisioning
adapters use contract tests and dry-run fixtures; live canaries cover the provider APIs that cannot
be proven locally.

## 14. Implementation order

1. Freeze and test the current web baseline. **Done.**
2. Define and validate manifest schema v1. **Done.**
3. Implement deterministic local composition with fixture matrix. **Done.**
4. Implement `plan`, receipt and `doctor` before external mutations. **Done.**
5. Add GitHub, Vercel and Neon provisioning. **Done; live creation, resume and adoption canaries
   passed.**
6. Publish the initial Git source. **Done; initial publication and guarded update canaries passed.**
7. Apply exact Drizzle migrations to Neon. **Done; empty-to-current live Neon canary passed.**
8. Observe the exact Production deployment and run a protected HTTP smoke. **Done; protected live
   bypass canary passed.**
9. Finish Better Auth production onboarding and explicit bootstrap/seed. **Done; guarded binding,
   Resend delivery, redeployment, magic-link session and exact-email admin access passed live.**
10. Add optional Expo/EAS surface. **Done; isolated project creation, guarded link publication,
    deterministic native-build plan/preflight/resume lifecycle, complete CI and protected
    Production smoke passed. Native execution remains intentionally blocked until signing,
    memberships and cost are explicitly approved.**
11. Add R2, Resend, observability and DNS adapters. **Resend done and live-validated; R2 is
    implemented, contract-tested and live-validated through creation, resume and stateless
    adoption; Sentry is implemented, contract-tested and live-validated through two-phase resume
    and stateless adoption; PostHog is implemented, contract-tested and live-validated through
    guarded resume and stateless adoption; Cloudflare DNS is implemented and contract-tested with
    guarded propagation resume, with its live canary pending.**
12. Add `resume` and failure injection tests. **Done for provider, source, migration, delivery,
    auth and EAS project tranches.**
13. Complete cross-provider smoke coverage. **Done for GitHub/Vercel/Neon/R2/Sentry/PostHog/EAS,
    local builds, remote CI/E2E, migrations, final doctor and protected HTTP smoke on one exact
    commit. DNS live is intentionally deferred until a dedicated zone exists.**
14. Add the durable-jobs workload. **Done; the Vercel World needs no provisioning, and the live
    canary proved a real remote run suspending and completing, a unique idempotency ledger row per
    step, a 401 on the anonymous trigger, and a green CI, migration, deployment and doctor on one
    exact commit. Selecting the workload requires an explicit non-EU processor approval (ADR 62).**
15. Connect Forge as manifest producer and Linear as project bootstrap.

## 16. Open decisions

- CLI/package name and distribution model.
- GitHub Actions secret-binding policy for unattended EAS builds; the local lifecycle now reads EAS
  environment metadata and keeps `EXPO_TOKEN` in process memory only.
- Exact provider rollback guarantees.
- Expo/React version alignment policy in the workspace.
- Boundary for future post-generation transformations beyond the receipt-owned EAS link overlay.
- Linear ownership: Forge creates product intent and backlog; Harness should update execution.
