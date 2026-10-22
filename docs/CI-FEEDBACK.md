# CI feedback

Keep development pull requests in draft and run the affected tests locally.
The published Void Machine 5.0.7 admission guard in `.github/scripts/ci-admission.mjs`
returns `CI_DEFERRED_DRAFT` (non-success, not test evidence). Marking the same PR
ready starts full validation without another commit; later commits validate again.
Returning to draft cancels obsolete runs of that PR only. Push, merge-group and
manual runs have separate concurrency identities and are never cancelled by a PR.

Secret scanning remains active on drafts. Required check names, application checks,
frozen installs, review protection and deployment/migration workflows are retained.
Push validation remains because this change does not prove it redundant.

Run `bun test ./.github/scripts/ci-admission.test.mjs` for the guard, actual workflow
conditions, required-check outcomes and lifecycle regression tests. The code job
also runs this contract in CI. No new dependency or test runner is required.

Rollback: revert the workflow and admission files together. This restores full draft
CI (more minutes), while keeping remote protection and existing evidence unchanged.

References: [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
