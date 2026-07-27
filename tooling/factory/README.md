# Starter Factory

`@repo/factory` is the build-time control plane for Void Starter. It is tested as a workspace
package but excluded from every generated repository.

The current slice exposes:

- `parseBuildManifest(input)` to validate schema v1 and reject unknown or inconsistent intent;
- `createCompositionPlan(manifest)` to normalize active surfaces, workloads and capabilities into
  a deterministic topology order;
- `createSurfaceFilePlan(manifest)` to preview the sorted Expo files and baseline surface removals;
- `createCapabilityFilePlan(manifest)` and `createProjectFilePlan(manifest)` to select the local
  package graph, application overlays and environment-variable example;
- `parseManifestSource(source, fileName)` and `createFactoryPreview(manifest)` for YAML or JSON
  dry runs;
- `renderProject(input)` to copy the baseline into a new target, apply selected surfaces, exclude
  secrets and development-only artifacts, and emit deterministic metadata;
- `createProvisioningPlan(manifest, context)` to plan non-secret GitHub, Vercel, Neon,
  Cloudflare R2, Sentry and PostHog reconciliation actions with stable idempotency keys;
- `applyProvisioning(input)` and the simulated adapter to exercise atomic state, locking,
  interruption recovery and resume without making remote changes;
- `LiveProvisioningAdapter` plus separate live CLIs for authenticated provider preflight,
  lookup-before-create reconciliation, private-EU R2, DE Sentry and EU PostHog validation, and
  in-memory secret transport;
- `createDeliveryPlan`, `preflightDelivery`, and `observeDelivery` to bind a Vercel Production
  deployment and HTTP smoke receipt to the exact published source commit;
- `doctorProject(target)` to verify the manifest, receipt, SHA-256 file digests, selected surfaces
  and capabilities, optional provisioning/source/delivery state, dependencies, and the absence of
  Harness/factory artifacts;
- `createProjectPackPlan`, `applyProjectPack`, and `checkProjectPack` to inject Forge foundation
  documents without overwriting unmanaged or locally modified files;
- `buildManifestSchema` and the corresponding public TypeScript boundary types.

Run a fixture preview without changing the repository:

```sh
cd tooling/factory
bun run plan -- fixtures/manifests/web-expo.yaml
```

Render a new repository and verify it:

```sh
cd tooling/factory
bun run generate -- fixtures/manifests/web-expo.yaml /absolute/path/to/new-project
bun run doctor -- /absolute/path/to/new-project

cd /absolute/path/to/new-project
git init
bun install
bun run hooks:install
```

`generate` refuses an existing target, a target inside the source repository, and source
symlinks. It copies neither `.env*` secrets nor caches, lockfiles, Harness state, factory source,
agent-governance files, internal discovery handoffs, or historical implementation plans. A
generated project receives `.void-starter/manifest.json` and `.void-starter/receipt.json`; the
receipt is deterministic and records SHA-256 digests for every generated file.

The fixture matrix covers public minimal web, Better Auth + Neon/Drizzle web, Clerk web,
mobile-only, and web + Expo. Unselected auth, database, sample-domain, PostHog and Sentry packages
and their application imports are removed. Clerk is materialized directly in the generated web
app; the `_modules/auth-clerk` documentation scaffold is never copied as runtime code. Expo output
is pinned to SDK 57, React Native 0.86, Expo Router, and EAS profiles for development, preview,
and production.

The current Better Auth, Clerk, PostHog and Sentry adapters target the Next.js surface. A manifest
that selects one of them without web is rejected instead of producing a misleading mobile
integration. Resend is live-validated. R2 has a deterministic provider plan, resumable live
adapter, private-domain checks, object canary and Vercel secret binding; creation, completed-state
resume and fresh-state adoption have passed against the isolated sandbox. Sentry project creation,
DE-region attestation, deterministic client-key selection, two-phase Vercel binding, completed-state
resume and fresh-state adoption have also passed against the isolated sandbox. DNS remains a
planned provider capability.

To materialize the Expo blueprint in a temporary directory, install it, type-check it, and export
the iOS, Android, and web bundles:

```sh
bun run validate:expo
```

Successful validation deletes its temporary directory. A failure keeps the directory path in the
error output for inspection.

Preview the first remote-resource tranche after generation:

```sh
bun run apply -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --dry-run
```

`--dry-run` is the default and writes nothing. It produces an ordered GitHub repository, Vercel
project, Neon project, database binding, EU-jurisdiction R2 bucket, R2 runtime binding, DE Sentry
project, Sentry runtime binding, EU PostHog project and PostHog runtime-binding plan according to
the selected manifest. The separate provisioning context contains account coordinates such as
owner, team, organization, Sentry slugs, PostHog organization ID and Cloudflare account IDs, never
tokens or secret values.

The resumable engine can currently be exercised without provider calls:

```sh
bun run apply -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --simulate

bun run resume -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --simulate
```

Simulation persists `.void-starter/apply-state.json` atomically after every action. It uses a
single-process lock, recovers locks whose process no longer exists, stores only opaque simulated
resource IDs and safe diagnostics, and skips completed actions on resume. `doctor` validates this
state when present.

Before allowing mutations, validate that each token targets the intended account:

```sh
GITHUB_TOKEN=... VERCEL_TOKEN=... NEON_API_KEY=... \
CLOUDFLARE_API_TOKEN=... SENTRY_API_TOKEN=... POSTHOG_PERSONAL_API_KEY=... \
  bun run preflight:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml
```

Preflight uses authenticated `GET` requests only. Tokens are read from the process environment and
are never accepted by the manifest or provisioning context. GitHub organization identity uses the
exact authenticated membership endpoint and requires `Organization permissions > Members:
Read-only`. Sentry preflight verifies that the exact active organization belongs to the
`de.sentry.io` region and that the token can access the selected team. PostHog preflight reads the
exact organization through `eu.posthog.com`.

Live apply is deliberately a separate command and requires the exact generated project name. R2
runtime credentials may be omitted on the first apply: the engine creates and validates the EU
private bucket, then stops with the retryable `CLOUDFLARE_R2_RUNTIME_CREDENTIAL_MISSING` code. This
lets the operator create an Object Read & Write token scoped to that exact bucket instead of
granting the application account-wide storage access. Supplying both credentials from the start
remains supported when an already-scoped token exists:

```sh
GITHUB_TOKEN=... VERCEL_TOKEN=... NEON_API_KEY=... \
CLOUDFLARE_API_TOKEN=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
SENTRY_API_TOKEN=... SENTRY_BUILD_AUTH_TOKEN=... \
POSTHOG_PERSONAL_API_KEY=... \
  bun run apply:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

It reconciles before creating and again after every create response. GitHub visibility, Vercel
framework/root directory, Neon region, the R2 bucket's `eu` jurisdiction, the Sentry project's DE
region/platform/team and the PostHog project's exact EU organization/name must match before an
existing resource is adopted. R2 adoption also
rejects any enabled managed or custom public domain and runs a deterministic upload/read/delete
object canary. Database, R2 and Sentry build secrets are posted to Vercel as `sensitive` for
Preview/Production and `encrypted` for Development, where Vercel does not support sensitive
variables. They are never written to factory state or read back. Separate non-secret ownership
markers make every binding recoverable.

After a bucket-scoped runtime token exists, load `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`
together and run `resume:live`; it skips the completed bucket action and finishes only the Vercel
binding. Supplying just one credential fails before provider calls.

Sentry follows the same two-phase least-privilege boundary. `SENTRY_API_TOKEN` controls active-DE
organization/team preflight plus project lookup/create. `SENTRY_BUILD_AUTH_TOKEN` is optional
until the Vercel binding action; when absent, apply records the retryable
`SENTRY_BUILD_AUTH_TOKEN_MISSING` failure. Provide a separate release-upload token and run
`resume:live`. The public DSN is fetched in memory and persisted only as its client-key ID and
SHA-256; Vercel receives `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`
and `SENTRY_PROJECT`.

PostHog uses one control-plane `POSTHOG_PERSONAL_API_KEY` with only `organization:read`,
`project:read` and `project:write`. The project key is fetched in memory and persisted only as a
SHA-256. Before binding, the adapter re-reads the exact project and verifies that digest. Vercel
receives encrypted `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST=/ingest` variables for
all targets, plus a plain `VOID_STARTER_POSTHOG_BINDING_ID` ownership marker.

An ambiguous provider create is recorded and `resume:live` performs lookup only; it never repeats
that create blindly. Live contract tests use mocked HTTP providers. The GitHub, Vercel and Neon
tranche, the R2 extension, the Sentry extension and the PostHog extension passed creation,
completed-state resume and stateless adoption against isolated sandbox accounts. The R2 canary
proved the two-phase
least-privilege flow:
create and validate the private bucket with the control token, then bind exact-bucket runtime
credentials on resume.

After `bun install` has generated the selected project lockfile, source publication remains a
separate lifecycle:

```sh
GITHUB_TOKEN=... bun run source:preflight -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml

GITHUB_TOKEN=... bun run source:live -- \
  /absolute/path/to/new-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo

GITHUB_TOKEN=... bun run source:update:preflight -- \
  /absolute/path/to/fresh-updated-project \
  fixtures/provisioning/eu.yaml

GITHUB_TOKEN=... bun run source:update:live -- \
  /absolute/path/to/fresh-updated-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

The source plan hashes the exact publishable file set, requires `bun.lock`, excludes local
operation state, env files, caches and build output, and refuses symlinks or credential files. The
initial commit is attributed to the authenticated GitHub user. Git authentication uses a
short-lived askpass helper with credential storage disabled; neither the token nor a token-bearing
remote URL is persisted. Existing `main` is adopted only when both its source marker and exact Git
tree match. `source:resume` safely reconciles an ambiguous push.

Generated Expo projects keep their EAS profiles but invoke the pinned operational CLI on demand
with `bun run eas:build`; `eas-cli` is not installed in the application dependency graph. After
source publication, `doctor` accepts the lifecycle-owned `.git` metadata only while the source
receipt remains structurally valid and matches the current snapshot.

Factory-managed revisions use a fresh generated target that has adopted the existing provider
resources. The update preflight requires the current remote HEAD to carry a Void Starter source
marker. Live update fetches that exact commit, verifies its tree and marker, creates one child
commit, rechecks the remote HEAD, and performs a normal fast-forward push. An unmarked, moved or
already-current remote fails closed; `source:update:resume` reconciles an ambiguous push.

Apply the exact published Drizzle history to the provisioned Neon database through another
receipt boundary:

```sh
NEON_API_KEY=... bun run migration:preflight -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

NEON_API_KEY=... bun run migration:live -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo

NEON_API_KEY=... bun run migration:resume -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

The plan binds the source commit and digest, opaque Neon project/database identity, and every
journaled SQL migration hash and timestamp. Preflight retrieves a direct Neon URI into memory and
only inspects `drizzle.__drizzle_migrations`. Live execution fails closed on divergent history,
holds both a local process lock and a PostgreSQL advisory lock, and applies pending migrations
through Drizzle's transaction. The API key and connection URI are never persisted. The atomic
`.void-starter/migration-state.json` receipt records only exact non-secret migration evidence;
`doctor` validates it and source publication excludes it.

Application seed/bootstrap is deliberately separate: the starter currently has no safe identity
from which to create or promote an administrator. That contract belongs to Better Auth production
onboarding, where the bootstrap principal can be explicit and auditable.

Observe the exact Vercel Production deployment and smoke its root page as a separate read-only
provider lifecycle:

```sh
VERCEL_TOKEN=... bun run delivery:preflight -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml

VERCEL_TOKEN=... VERCEL_AUTOMATION_BYPASS_SECRET=... \
  bun run delivery:live -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo

VERCEL_TOKEN=... VERCEL_AUTOMATION_BYPASS_SECRET=... \
  bun run delivery:resume -- \
  /absolute/path/to/published-project \
  fixtures/provisioning/eu.yaml \
  --confirm-project web-expo
```

The plan is bound to the source-publication commit and SHA-256, provisioned Vercel team/project,
and Production target. Live observation polls only that commit, requires `READY`, then expects a
200 HTML root page containing the generated project name. Deployment evidence and a body digest
are written atomically to `.void-starter/delivery-state.json`; the Vercel token and optional
Deployment Protection bypass secret remain in process memory. A protected deployment without a
valid bypass fails with a resumable safe code. Delivery state and locks are excluded from source
publication, and `doctor` validates a completed receipt against the source state.

Local `generate` still writes only to its new target. Production auth bootstrap/seed remains a
later lifecycle stage. No ordinary `apply` or `resume` flag silently turns simulation into remote
mutation.

Inject a Forge Project Pack after generation, or into an existing project, with a non-mutating
preview first:

```sh
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

The adapter consumes `forge/project-pack-v1`. First injection is create-only. Later injection can
replace a destination only when its current SHA-256 matches
`.void-starter/project-pack-receipt.json`. A missing, manually changed, symlinked, or unmanaged
destination blocks the entire apply. `preview` and `check` never write. This lifecycle is separate
from generation and remote provisioning.

Void Harness may be used externally while developing this package. Harness artifacts and package
dependencies must never be added to this workspace or to generated outputs.
