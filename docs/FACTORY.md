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

The implemented factory slice lives in `tooling/factory`. It validates schema v1 with strict Zod
objects, produces a deterministic ordered composition plan, previews a sorted local file plan, and
can render the selected surfaces into a new directory. The Expo blueprint targets SDK 57, React
Native 0.86, Expo Router, and EAS. The EAS configuration is generated, while its pinned CLI runs
on demand through `bun run eas:build` and does not inflate the application lockfile. Rendering
remains local. A separate provisioning plan can now model the first GitHub, Vercel and Neon
resource tranche. Dry-run and simulation remain the safe defaults; authenticated execution is
isolated behind separate live commands.

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
- PostHog and Sentry package/configuration overlays;
- mobile-only pruning of every Next.js-only package.

The selected capability set also produces a deterministic `.env.example`; it contains placeholders
only, never secret values. Better Auth, Clerk, PostHog and Sentry are currently web adapters, so
selecting them without a Next.js surface is rejected. R2, Resend and DNS remain provider-plan
intent until `apply` adapters materialize their remote resources.

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
```

This strict document accepts no credentials. Owner, team and organization IDs are explicit so the
factory never derives or invents opaque provider identity. The first live contract fixes Vercel
to `fra1` and Neon to `aws-eu-central-1`. Generated web projects contain
`apps/web/vercel.json`, so Vercel Functions do not silently fall back to the `iad1` default.

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

The first authenticated adapter covers GitHub repository, Vercel project, Neon project and the
Vercel `DATABASE_URL` binding. Credentials exist only in process memory:

```sh
export GITHUB_TOKEN=...
export VERCEL_TOKEN=...
export NEON_API_KEY=...

bun run preflight:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml
```

The preflight performs only authenticated reads. It verifies the GitHub user or active
organization membership, exact Vercel team ID and accessible Neon organization ID. It creates no
state and performs no mutation. For an organization owner, the fine-grained GitHub token requires
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

The live adapter is covered by HTTP contract mocks, secret-persistence assertions, adoption tests,
identity mismatch tests and ambiguous-create resume tests. Its isolated-account canary created all
four resources once, kept their IDs on completed-state resume, and adopted them from a fresh local
state without duplication.

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

GitHub permits personal access tokens in place of HTTPS passwords:
[GitHub PAT command-line authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
Vercel automatically deploys pushes to a connected repository and detects the package manager
from the root lockfile:
[Vercel Git deployments](https://vercel.com/docs/git) and
[Vercel monorepos](https://vercel.com/docs/monorepos).

### 10.5 Deployment observation and HTTP smoke

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
commands implement guarded initial publication and fast-forward updates. The delivery commands
implement exact-commit Vercel observation and protected HTTP smoke verification. Production
migrations and seed remain future actions.

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
- Better Auth + PostHog + Sentry web and Expo.

The remaining remote validation target includes:

- web invite-only internal tool;
- durable jobs;
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
7. Observe the exact Production deployment and run a protected HTTP smoke. **Contract complete;
   live bypass canary pending.**
8. Finish Better Auth production onboarding, migrations and seed.
9. Add optional Expo/EAS surface. **Local surface done; EAS provisioning pending.**
10. Add R2, Resend, observability and DNS adapters.
11. Add `resume` and failure injection tests. **Done for provider, source and delivery tranches.**
12. Connect Forge as manifest producer and Linear as project bootstrap.

## 15. Open decisions

- CLI/package name and distribution model.
- Secret binding model across local, Vercel, EAS and GitHub Actions.
- Exact provider rollback guarantees.
- Expo/React version alignment policy in the workspace.
- Boundary between generated code, overlays and post-generation transformations.
- Linear ownership: Forge creates product intent and backlog; Harness should update execution.
