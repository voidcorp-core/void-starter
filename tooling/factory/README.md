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
- `createProvisioningPlan(manifest, context)` to plan non-secret GitHub, Vercel and Neon
  reconciliation actions with stable idempotency keys;
- `applyProvisioning(input)` and the simulated adapter to exercise atomic state, locking,
  interruption recovery and resume without making remote changes;
- `doctorProject(target)` to verify the manifest, receipt, SHA-256 file digests, selected surfaces
  and capabilities, optional provisioning state, dependencies, and the absence of Harness/factory
  artifacts;
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
or agent-governance files. A generated project receives `.void-starter/manifest.json` and
`.void-starter/receipt.json`; the receipt is deterministic and records SHA-256 digests for every
generated file.

The fixture matrix covers public minimal web, Better Auth + Neon/Drizzle web, Clerk web,
mobile-only, and web + Expo. Unselected auth, database, sample-domain, PostHog and Sentry packages
and their application imports are removed. Clerk is materialized directly in the generated web
app; the `_modules/auth-clerk` documentation scaffold is never copied as runtime code. Expo output
is pinned to SDK 57, React Native 0.86, Expo Router, and EAS profiles for development, preview,
and production.

The current Better Auth, Clerk, PostHog and Sentry adapters target the Next.js surface. A manifest
that selects one of them without web is rejected instead of producing a misleading mobile
integration. R2, Resend and DNS remain planned provider capabilities. The GitHub, Vercel and Neon
tranche has a deterministic plan and simulated state machine; authenticated remote adapters are
still future scope.

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
project, Neon project and Vercel database-binding plan according to the selected manifest. The
separate provisioning context contains account coordinates such as owner, team and organization
IDs, never tokens or secret values.

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

Local `generate` still writes only to its new target. Live provider execution, secret binding and
deployment remain unavailable; no flag silently turns simulation into remote mutation. Those
external lifecycle stages follow the order in `docs/FACTORY.md`.

Void Harness may be used externally while developing this package. Harness artifacts and package
dependencies must never be added to this workspace or to generated outputs.
