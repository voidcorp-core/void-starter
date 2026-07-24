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
- `doctorProject(target)` to verify the manifest, receipt, SHA-256 file digests, selected surfaces
  and capabilities, dependencies, and the absence of Harness/factory artifacts;
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
integration. R2, Resend, DNS and provider provisioning remain planned capabilities: generation
emits their selected environment bindings, while remote `apply` work is still future scope.

To materialize the Expo blueprint in a temporary directory, install it, type-check it, and export
the iOS, Android, and web bundles:

```sh
bun run validate:expo
```

Successful validation deletes its temporary directory. A failure keeps the directory path in the
error output for inspection.

Local `generate` writes only to its new target. It does not provision providers, bind secrets, or
deploy yet. Those external lifecycle stages follow the order in `docs/FACTORY.md`.

Void Harness may be used externally while developing this package. Harness artifacts and package
dependencies must never be added to this workspace or to generated outputs.
