# CI and Branch Protection

This document describes the CI pipeline shipped in `.github/workflows/ci.yml` and the recommended branch protection rules for repositories derived from this starter.

## Pipeline overview

CI runs on every push to `main`, on every pull request that is ready for review, on the merge
queue (`merge_group`) and on manual dispatch. These jobs start independently:

- `code`: lint, migrations, one Turbo run of `type-check`, `test` and `build`, then knip.
- `versions` then `e2e-shard`: the Playwright suite, split in shards (one runner each).
- `dependency-audit` and `secrets`: the independent security checks.

Two aggregation jobs carry the required check names:

- `quality` succeeds only when `code`, `dependency-audit` and `secrets` all succeeded.
- `e2e` succeeds only when every `e2e-shard` succeeded.

Both use `always()`, so a failed, cancelled or skipped prerequisite produces a failed required
check, never a skipped (green) one. Both run the draft admission guard (`docs/CI-FEEDBACK.md`).
The required check names remain `quality` and `e2e`.

All external actions are pinned to full commit SHAs. The workflow token has `contents: read`.
Bun is selected from `package.json#packageManager` to avoid a second version declaration.

Concurrency is scoped per pull request so a new commit cancels the in-flight run of that pull
request. Push, merge queue and manual runs are never cancelled.

### Job: `code`

Steps, in order:

1. Checkout with `fetch-depth: 2`: both parents of the pull request merge commit.
2. Set up Bun at the version pinned in `package.json#packageManager`.
3. Set up Node.js 24 LTS via `actions/setup-node@v6`. Bun is the workspace runtime, but several tools we depend on (Vitest, Drizzle Kit, Playwright) ship binaries with a `#!/usr/bin/env node` shebang; pinning Node 24 explicitly gives us reproducible CI, parity with the local dev runtime, and native `.ts` loading across `package.json#exports` boundaries (the case for `@repo/config/vitest.base.ts`) because Node 23.6+ ships `--experimental-strip-types` on by default. No `NODE_OPTIONS` flag needed. See `docs/DECISIONS.md` entry 30.
4. Restore the bun install cache and the Turbo cache (see [Cache strategy](#cache-strategy)).
5. `bun test ./.github/scripts`: the CI scripts and workflow contract.
6. `node .github/scripts/ci-scope.mjs`: chooses the affected or the full Turbo graph (see [Affected scope](#affected-scope)).
7. `bun install --frozen-lockfile`, then `bun run lint` (Biome, whole repository).
8. `cd packages/db && bunx drizzle-kit migrate` against the CI Postgres.
9. `bunx turbo run type-check test build --summarize`, with `--affected` when the scope allows it. One run lets Turbo overlap independent tasks. `next build` skips its own type check (`apps/web/next.config.ts`), so `type-check` in this run is the type gate.
10. `bun run knip` for dead code and unused exports (whole repository).
11. On a `main` push only: prune the Turbo cache to this run, then save both caches.

Any failure aborts the job. Subsequent steps do not run.

### Independent security checks

`dependency-audit` installs the frozen lockfile with lifecycle scripts disabled and runs
`bun run audit`. Every published advisory remains blocking, including development dependencies.

`secrets` checks out full history (`fetch-depth: 0`), downloads Gitleaks 8.30.1, verifies the
archive against a committed SHA-256 digest, then runs `gitleaks git --redact --verbose`.
It never installs or runs project packages. The download fails on HTTP errors and has bounded
retries and a timeout. A Gitleaks update must update the version and verified digest together.

The local CI contract tests (`.github/scripts/*.test.mjs` and
`tooling/factory/src/ci-workflow.test.ts`) execute both gates for success, failure,
cancellation, and skipped results.

### Jobs: `e2e-shard` and `e2e`

`versions` (`.github/scripts/ci-versions.mjs`, a few seconds, no install) reads the one
Playwright version `bun.lock` resolves and the bun version of `package.json#packageManager`.
Any ambiguity fails it, which skips the shards and turns `e2e` red.

`e2e-shard` runs alongside `code`, not after it: each shard starts its own Postgres service and
`next dev` server and uses no output of `code`. It is a matrix (`shard: [1, 2]`) running in the
official image `mcr.microsoft.com/playwright:v<version>-noble`, which carries the browsers and
their system libraries: no `playwright install --with-deps`, whose apt mirror took 4.5 minutes on
2026-10-22 and failed outright on 2026-11-11. Each runner:

1. Checkout, set up Node 24, install bun from npm at the pinned version (`setup-bun` needs
   `unzip`, absent from the image), install with the frozen lockfile.
2. Applies DB migrations against its own Postgres service, reached as `postgres:5432` (a
   container job reaches services by label, not `localhost`).
3. Runs `bun run test:e2e --shard=<i>/<n>` from `apps/web`. On CI the config writes a blob report.
4. On failure, uploads `blob-report-<i>` (kept one day).

`e2e` is the required check. It fails unless every shard succeeded. When a shard failed, it
downloads the blob reports and runs `playwright merge-reports` into one `playwright-report`
artifact.

To split further, add a number to `matrix.shard`: the `n` of `--shard=i/n` is
`strategy.job-total`. Each shard pays a fixed setup (about one minute: image and services,
install, dev server compile), so add one when the suite itself exceeds that per shard.
Playwright keeps one worker per shard on CI, as its documentation recommends.

E2E tests under `apps/web/tests/e2e/` skip gracefully when `DATABASE_URL` is unset (per `docs/AUTH.md`). In CI we provide `DATABASE_URL`, so all of them run.

## Affected scope

`.github/scripts/ci-scope.mjs` narrows the Turbo run to `--affected` only when every condition
holds; otherwise the full graph runs:

- the event is `pull_request` (push, merge queue and manual runs always prove the full graph);
- `HEAD` is the pull request merge commit (two parents), whose first parent is the base tip;
- the diff against that base is readable and not empty;
- every changed path is inside a workspace package (`apps/*`, `packages/*`, `_modules/*`,
  `tooling/*`) or is documentation (`docs/`, Markdown, `.void/`, `.claude/`, `.agents/`,
  `.codex/`, issue and pull request templates).

Any other path (`bun.lock`, `package.json`, `turbo.json`, `biome.json`, `knip.json`,
`.github/**`, a new root file) runs the full graph. Turbo then compares `TURBO_SCM_BASE...HEAD`
and selects changed packages plus their dependents. It also widens to every package on its
own global inputs, and when the checkout is too shallow to compare.

Lint and knip always cover the whole repository: they are fast and outside Turbo.

**A test that reads a file outside its package** must declare it in a package `turbo.json`
with `$TURBO_ROOT$`, or Turbo replays it from cache when only that file changed. `--affected`
is package-level (Turbo 2.11), so it never selects a package for a root file: the scope plan
covers that by running the full graph for any root path that is not documentation. Keep a
read root file out of the documentation patterns of `ci-scope.mjs`. Example:
`tooling/factory/turbo.json` declares `.github/workflows/ci.yml` and `biome.json` for the CI
contract test.

## Cache strategy

| Cache       | Path                   | Key                         | Restored by                               | Saved by                    |
| ----------- | ---------------------- | --------------------------- | ----------------------------------------- | --------------------------- |
| Bun install | `~/.bun/install/cache` | `<os>-bun-<hash(bun.lock)>` | `code`, by prefix except on `main` pushes | `main` push, exact key only |
| Turbo       | `.turbo/cache`         | `<os>-turbo-<sha>`          | `code`, by prefix: the latest seed        | `main` push, after pruning  |

Why this shape:

- **Only `main` saves.** A pull request can restore caches from its own ref and from the base
  or default branch, never from another pull request. Saving from pull requests therefore
  benefits nobody else and competes for the 10 GB repository quota (measured in Rekalibr,
  DEV-1270: a 1.6 GB upload per lockfile change that evicted the base seeds). Merge queue runs
  restore the `main` seed too.
- **The Turbo key changes on every `main` commit.** A key is never overwritten: keyed by the
  lockfile, `.turbo` stayed frozen at its first save and the hit rate decayed with each merge.
  Each `main` push restores the previous seed, runs the full graph, then saves under its SHA,
  so pull requests restore the latest `main` tree and only miss what they changed.
- **The seed is pruned.** Restoring by prefix carries every older entry forward.
  `node .github/scripts/ci-cache.mjs prune` keeps only the task hashes named by this run's
  summaries (`--summarize`) and refuses to run without one. The seed stays one tree in size;
  older seeds are evicted first by GitHub (7 days unused, or least recently used over quota).
- **The bun cache restores by exact key on `main`.** A lockfile change installs cold once and
  saves a fresh cache instead of accumulating every older package.
- **Task hashes must match across events.** The `code` job env is identical for every event,
  and `TURBO_SCM_*` are not task inputs, so a pull request hits the entries a `main` push saved.

The browser shards use no cache: the image carries the browsers, and in Rekalibr restoring the
bun cache inside the container measured slower (57 s) than a cold install (37 s).

**Vercel Remote Cache (opt-in).** A project already on Vercel can share hits between pull
requests and local machines through `vercel/setup-turborepo-remote-cache-action` with an OIDC
policy (see Turbo's GitHub Actions guide). It needs a Vercel team and is not wired by default.

## Time budget

Target: **about 10 minutes** of wall-clock time from a pull request marked ready to both
required checks green, warm cache, for a complete pull request (one touching the web app, so
the whole graph is affected). Measured on this starter before DEV-1271: 2.5 to 3.3 minutes,
with `code` (about 45 to 95 s) and `e2e` (about 100 s) in series. A cold cache (first run after
a seed expires) may exceed the target once.

How to measure, with the GitHub CLI:

```bash
# Wall-clock time of the last successful pull request runs.
gh run list --workflow ci.yml --event pull_request --status success --limit 20 \
  --json databaseId,headBranch,createdAt,updatedAt \
  --jq '.[] | "\(.databaseId)\t\(.headBranch)\t\(((.updatedAt | fromdate) - (.createdAt | fromdate)) / 60 * 10 | floor / 10) min"'

# Where one run spends its time, per job.
gh run view <run-id> --json jobs \
  --jq '.jobs[] | "\(.name)\t\((.completedAt | fromdate) - (.startedAt | fromdate)) s"'
```

The critical path is `max(code, slowest e2e-shard)` plus the aggregation job. When it drifts
over budget: read the `ci-scope:` line in the `code` job summary (a full graph where an
affected one was expected), the Turbo summary (cache misses on unchanged packages mean the
seed is stale or the env differs), and the per-shard durations (add a shard when one exceeds
the others by minutes).

## Merge queue

The workflow already handles `merge_group` (`checks_requested`): every job runs, the scope is
the full graph, and the run is never cancelled by a pull request. To enable the queue:

1. Settings, then Rules, then Rulesets (or the classic branch protection rule for `main`).
2. Enable "Require merge queue" for `main`; keep `quality` and `e2e` as required checks.
3. The queue provides the same guarantee as "Require branches to be up to date before
   merging" without asking authors to rebase; that rule can be turned off.

The required checks must report on `merge_group` events, which they do. Once the queue gates
`main`, the push run becomes a cache seed rather than a second proof; keep it, since it is
what refreshes the Turbo cache for pull requests and merge groups.

References: [managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue),
[dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching),
[Playwright sharding](https://playwright.dev/docs/test-sharding), Turbo `--affected` and
GitHub Actions guides (`node_modules/turbo/docs/reference/run.mdx`,
`node_modules/turbo/docs/guides/ci-vendors/github-actions.mdx`).

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
Do not require the `e2e-shard (n)` checks: their number changes with the matrix, and `e2e`
already fails unless every shard passed.

### Required up-to-date branch

Tick "Require branches to be up to date before merging". This forces the PR branch to merge `main` (or rebase) before the merge button enables, catching conflicts that pass CI in isolation but break once integrated. With the [merge queue](#merge-queue) enabled, the queue provides this guarantee instead.

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
- **`bun run audit` fails**: a direct or transitive dependency has a published advisory. Update the owning dependency first; use a temporary root override only when the upstream range still resolves a vulnerable release, and record it in ADR 36.
- **`bun run lint` fails**: Biome found a style issue. Run `bun run lint:fix` locally.
- **`bun run type-check` fails**: TypeScript caught a regression. Read the error; do not weaken types to silence it.
- **`drizzle-kit migrate` fails**: a migration is malformed or the schema diverged. Re-run `bun run db:generate` in `packages/db`.
- **`bun run test` fails**: a unit test caught a regression. Read the failure; do not skip the test.
- **`bun run build` fails**: a Next.js compilation issue (often a Server/Client component boundary or a missing `'use client'`). See `docs/PATTERNS.md` for the boundary rules.
- **`bunx knip` fails**: dead code or an unused export was introduced. Either delete it or wire it up.
- **`gitleaks` fails**: a secret was committed. Rotate it immediately, then `git filter-repo` to scrub history.
- **Playwright tests fail**: download the `playwright-report` artifact (merged across the failed shards by the `e2e` job) from the run summary for screenshots, traces, and DOM snapshots.
- **`ci-cache.mjs prune` fails on `main`**: the Turbo run wrote no summary. The cache is not saved; pull requests keep restoring the previous seed. Check that the Turbo step still passes `--summarize`.

## Cross-references

- `docs/DECISIONS.md` entry 11: Neon vs self-hosted Postgres.
- `docs/AUTH.md`: how E2E tests handle missing `DATABASE_URL`.
- `docs/PATTERNS.md`: Server/Client boundary rules that the build enforces.
- `docs/SECURITY.md`: gitleaks scope and secret rotation procedure.
