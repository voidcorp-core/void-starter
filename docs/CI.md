# CI and Branch Protection

This document describes the CI pipeline shipped in `.github/workflows/ci.yml` and the recommended branch protection rules for repositories derived from this starter.

## Pipeline overview

CI runs on every push to `main` and on every pull request. Two jobs run in sequence: `quality` gates the PR on static analysis, type safety, unit tests, build, dead-code detection, and secrets scanning. `e2e` then runs Playwright end-to-end tests against a freshly migrated Postgres.

Concurrency is scoped per ref so a force-push or new commit cancels the in-flight run, saving Actions minutes.

### Job: `quality`

Steps, in order:

1. Checkout the repository.
2. Set up Bun at the version pinned in `package.json#packageManager` (currently `1.3.13`).
3. Restore the Bun install cache and the Turborepo cache, keyed by the hash of `bun.lock`.
4. `bun install --frozen-lockfile` to materialize workspace links and module graph.
5. `bun run lint` (Biome).
6. `bun run type-check` (Turborepo fan-out, each package runs `tsc --noEmit`).
7. `cd packages/db && bunx drizzle-kit migrate` to apply schema migrations to the CI Postgres.
8. `bun run test` (Turborepo fan-out, each package runs `vitest run`).
9. `bun run build` (Turborepo fan-out, `apps/web` runs `next build`).
10. `bunx knip --no-progress` to detect dead code, unused exports, and orphaned files.
11. `gitleaks/gitleaks-action@v2` to scan the diff for accidentally committed secrets.

Any failure aborts the job. Subsequent steps do not run.

### Job: `e2e`

Depends on `quality`. Steps:

1. Checkout, set up Bun, install with the frozen lockfile.
2. Apply DB migrations against the job's own Postgres service container.
3. Install the Playwright Chromium browser with system dependencies.
4. Run `bun run test:e2e` from `apps/web` (Playwright with the `chromium` project).
5. On failure, upload the `playwright-report` artifact for download from the run summary.

E2E tests under `apps/web/tests/e2e/` skip gracefully when `DATABASE_URL` is unset (per `docs/AUTH.md`). In CI we provide `DATABASE_URL`, so all of them run.

## Cache strategy

The `quality` job caches `~/.bun/install/cache` and `.turbo`, keyed by `hashFiles('bun.lock')`. A change to the lockfile invalidates the cache; otherwise both caches roll forward across runs.

- Bun install cache shaves ~30s off `bun install` once warm.
- Turborepo cache makes incremental `lint`, `type-check`, `test`, and `build` cheap (Turbo skips tasks whose inputs are unchanged).

The `e2e` job does not cache because its hot path is the Playwright browser download, which is layered into the `setup-bun` action's runner image and not worth caching across jobs.

## Postgres rationale: docker in CI, Neon in dev/prod

CI uses `postgres:16-alpine` as a service container instead of a Neon CI branch. The trade-off:

- CI tests verify schema migrations and query correctness, not connection pool behavior.
- Drift between docker Postgres and Neon's pooled endpoint is negligible for these test paths.
- Service containers spin up in seconds, do not require a Neon API token in CI, and cannot incur quota usage.

Production and dev use Neon (see `docs/DECISIONS.md` entry 11). If a future test path needs Neon-specific behavior (extensions, pooler quirks), promote that test to a Neon CI branch then.

## Env stubs

CI provides minimal env stubs so the build and migration steps run cleanly:

- `DATABASE_URL` points at the service container.
- `BETTER_AUTH_SECRET` is a 53-character test string. Better-Auth requires `min(32)` (see `packages/auth/src/auth.repository.ts`).
- `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` both point at `http://localhost:3000`. The build does not actually serve, but the env validators expect URLs.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are present as `ci-stub`. Better-Auth's Google OAuth provider is configured but never invoked in CI; the validator only checks presence.

These stubs are not secrets. Real production values live in Vercel project settings.

## Recommended branch protection rules

Configure these in the GitHub repo at Settings, then Branches, then Add rule (or edit the existing rule) for the `main` branch.

### Required status checks

Require both jobs to pass before merging:

- `quality`
- `e2e`

After the first CI run completes on a PR, both job names appear in the required-checks picker.

### Required up-to-date branch

Tick "Require branches to be up to date before merging". This forces the PR branch to merge `main` (or rebase) before the merge button enables, catching conflicts that pass CI in isolation but break once integrated.

### Linear history

Tick "Require linear history". This blocks merge commits and forces squash or rebase merges. Aligns with the Conventional Commits convention this repo follows.

### Signed commits (recommended)

Tick "Require signed commits" if your team has GPG or SSH commit signing set up. Not strictly required for a solo starter, but strongly recommended once contributors are added so commit authenticity is verifiable.

### Auto-delete head branches

Under repo Settings, then General, then Pull Requests, tick "Automatically delete head branches". Keeps the branch list clean once PRs merge.

### Block force-pushes and direct pushes to main

Tick "Do not allow bypassing the above settings" so administrators are also subject to the rules. This is the difference between a recommendation and a guarantee.

### How to enable

1. Go to Settings, then Branches.
2. Click "Add rule" (or edit the existing `main` rule).
3. Branch name pattern: `main`.
4. Check "Require a pull request before merging".
5. Check "Require status checks to pass before merging", then "Require branches to be up to date before merging", then add `quality` and `e2e` to the required list.
6. Check "Require linear history".
7. (Optional) Check "Require signed commits".
8. Check "Do not allow bypassing the above settings".
9. Click "Create" or "Save changes".

Repeat for any other long-lived branch (e.g., `develop`, `staging`) if your workflow uses them.

## When CI fails

Common failure modes:

- **`bun install` fails**: someone bumped a dep without updating `bun.lock`. Run `bun install` locally and commit the lockfile.
- **`bun run lint` fails**: Biome found a style issue. Run `bun run lint:fix` locally.
- **`bun run type-check` fails**: TypeScript caught a regression. Read the error; do not weaken types to silence it.
- **`drizzle-kit migrate` fails**: a migration is malformed or the schema diverged. Re-run `bun run db:generate` in `packages/db`.
- **`bun run test` fails**: a unit test caught a regression. Read the failure; do not skip the test.
- **`bun run build` fails**: a Next.js compilation issue (often a Server/Client component boundary or a missing `'use client'`). See `docs/PATTERNS.md` for the boundary rules.
- **`bunx knip` fails**: dead code or an unused export was introduced. Either delete it or wire it up.
- **`gitleaks` fails**: a secret was committed. Rotate it immediately, then `git filter-repo` to scrub history.
- **Playwright tests fail**: download the `playwright-report` artifact from the run summary for screenshots, traces, and DOM snapshots.

## Cross-references

- `docs/DECISIONS.md` entry 11: Neon vs self-hosted Postgres.
- `docs/AUTH.md`: how E2E tests handle missing `DATABASE_URL`.
- `docs/PATTERNS.md`: Server/Client boundary rules that the build enforces.
- `docs/SECURITY.md`: gitleaks scope and secret rotation procedure.
