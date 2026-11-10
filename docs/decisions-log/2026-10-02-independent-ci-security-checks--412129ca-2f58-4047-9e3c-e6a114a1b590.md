---
schemaVersion: 1
id: "adr:412129ca-2f58-4047-9e3c-e6a114a1b590"
createdAt: "2026-10-02T15:05:00.000Z"
title: "Run CI security checks independently"
status: proposed
deciders: [folpe]
supersedes: []
---

# Run CI security checks independently

## Context

The audit found 29 registry advisories in the current lockfile. Previously `bun run audit`
preceded lint, types, tests, build, knip and Gitleaks in one job. An advisory therefore prevented
collecting code evidence and scanning secrets, repeating the failure recorded on DEV-783.

## Decision

Run `code`, `dependency-audit` and `secrets` independently. Preserve the required `quality`
check as an aggregation that rejects failed, cancelled or skipped prerequisites. Run `e2e`
after `code`. Existing branch protection can continue requiring `quality` and `e2e`.

Pin external actions to full commit SHAs. Verify the Gitleaks archive against the digest
recorded from the official release API before extraction. Fetch full history in the secrets
job, which does not install project dependencies. Grant only `contents: read`.

## Alternatives considered

- Moving audit to the end of the code job: a code failure would still hide dependency evidence.
- Making the audit non-blocking: would allow projects with known advisories to pass the gate.
- Requiring three new check names: creates a branch-protection migration for every consumer.

## Consequences and reversal

The workflow uses additional runners and repeats a frozen install for the audit job. Security
results remain available even when code checks fail. Reversal fits in one workflow edit but
would restore the loss of independent evidence. No remote protection settings are changed.

## Evidence and sources

`tooling/factory/src/ci-workflow.test.ts` exercises the gate with success, failure, cancellation
and skipped prerequisite results, plus checkout depth, job independence and SHA pins.

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/actions/reference/security/secure-use
- https://api.github.com/repos/gitleaks/gitleaks/releases/tags/v8.30.1
