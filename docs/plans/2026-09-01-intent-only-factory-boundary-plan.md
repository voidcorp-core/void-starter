---
title: Intent-only Void Starter factory migration
date: 2026-09-01
status: executing
spec: docs/specs/2026-09-01-intent-only-factory-boundary.md
ticket: DEV-684
author: Florent Pellegrin + Codex
high_risk: true
---

# Intent-only Void Starter factory migration plan

## Goal

Replace Void Starter's credential-bearing remote execution product with a finite, credential-free
factory contract: strict manifest validation, deterministic local generation, one versioned
provisioning handoff plan, one derived human runbook, and a local-only doctor. Remove every shipped
provider mutation, resume, authenticated preflight, migration, publication, delivery, auth-binding,
and EAS execution path without deleting remote resources or losing the intent encoded by those
paths.

## Delivery strategy

This is a breaking product-boundary migration, not a mechanical deletion. The replacement handoff
must cover a lifecycle before that lifecycle's executor is retired. Each slice therefore crosses
schema, generation, runbook, doctor, public surface, tests, and documentation as applicable.

The MVP cut is Step 1: a minimal web project can generate and locally verify a useful version 2
handoff without credentials or provider networking. Later slices add the remaining provider intent
and delete the matching live executor.

No step may:

- call a live provider for verification;
- accept or persist a provider credential value;
- delete, rotate, migrate, or clean up a remote resource;
- edit `bun.lock` or any other lockfile through an agent action;
- claim completion from cached or historical evidence alone.

When a package dependency removal requires a lockfile refresh, the step stops at its named human
gate. A human regenerates and reviews the lockfile; execution resumes only after frozen install and
repository checks pass against that exact change.

## Steps

### Step 1 - Ship the minimal offline handoff slice

- **Goal**: Generate and locally verify a version 2 handoff plan and runbook for the minimal web
  profile, without invoking or emulating remote execution.
- **Depends on**: none
- **TDD mode**: strict
- **Files**:
  - add `tooling/factory/src/provisioning-handoff.types.ts`;
  - add `tooling/factory/src/provisioning-handoff.service.ts`;
  - add `tooling/factory/src/provisioning-handoff.service.test.ts`;
  - add `tooling/factory/src/doctor.service.test.ts`;
  - modify `tooling/factory/src/generation.service.ts`;
  - modify `tooling/factory/src/generation.service.test.ts`;
  - modify `tooling/factory/src/doctor.service.ts`;
  - modify `tooling/factory/src/factory.types.ts`;
  - modify `tooling/factory/src/index.ts`;
  - use `tooling/factory/fixtures/manifests/web-minimal.yaml` and
    `tooling/factory/fixtures/provisioning/eu.yaml` as the first contract fixtures.
- **Behavior**:
  - generation writes `.void-starter/provisioning-plan.json` with `schema_version: 2`,
    `execution_owner: external`, the normalized manifest digest, and stable action IDs;
  - generation writes `docs/PROVISIONING.md` from the same normalized model;
  - the version 2 types own the strict non-secret provider context parser needed by handoff
    generation, so deleting version 1 provisioning types will not remove context validation;
  - the minimal slice covers GitHub repository intent and Vercel project intent when the web
    surface selects Vercel;
  - the generation receipt records the handoff-plan digest;
  - doctor validates plan/runbook/receipt agreement without importing a live provider service;
  - a test replaces provider networking with a throwing guard and supplies sentinel credential
    values in the process environment; generation and doctor still pass and emit none of them.
- **Verification gate**:
  - the new service tests fail before production code and pass afterward;
  - two runs over identical inputs produce byte-identical plan and runbook artifacts;
  - `bun run --cwd tooling/factory test` passes, including the new handoff, generation, and doctor
    files;
  - `bun run --cwd tooling/factory type-check` and `bun run --cwd tooling/factory lint` pass;
  - pre-commit hooks pass on the staged files.
- **Expected commits**:
  - `test(factory): specify minimal external provisioning handoff`
  - `feat(factory): generate the version 2 provisioning handoff`
- **Notes**: Do not reuse the version 1 action schema under a new name. Version 2 must have no
  adapter mode, idempotency key, provider endpoint, request payload, response schema, or executable
  success state.

### Step 2 - Cover the complete infrastructure intent graph

- **Goal**: Preserve every desired resource and binding currently expressed by generic live
  provisioning before its executor is removed.
- **Depends on**: Step 1
- **TDD mode**: strict
- **Files**:
  - modify `tooling/factory/src/provisioning-handoff.types.ts`;
  - modify `tooling/factory/src/provisioning-handoff.service.ts`;
  - modify `tooling/factory/src/provisioning-handoff.service.test.ts`;
  - modify `tooling/factory/src/generation.service.test.ts`;
  - use `canonicalManifest` from
    `tooling/factory/src/__fixtures__/manifest.fixture.ts` to cover PostHog without selecting a
    mobile lifecycle that Step 7 has not migrated yet;
  - use `tooling/factory/fixtures/manifests/web-only.yaml`,
    `tooling/factory/fixtures/manifests/web-eu-documents.yaml`, and
    `tooling/factory/fixtures/provisioning/eu.yaml` as the coverage matrix;
  - read intent from `tooling/factory/src/provisioning-plan.service.ts` and
    `tooling/factory/src/provisioning.types.ts`, but do not import their executable types into the
    version 2 contract.
- **Behavior**:
  - the handoff covers GitHub repository, Vercel project, Neon project, database binding, R2 bucket,
    R2 CORS, R2 runtime binding, Sentry project/binding, PostHog project/binding, Vercel project
    domain, and Cloudflare DNS intent when selected;
  - dependencies and required non-secret outputs preserve the current topological order;
  - secret names, deployment targets, sensitivity classes, EU/DE regions, private-storage rules,
    DNS ownership, and paid-upgrade approval requirements remain explicit;
  - no provider API endpoint, token scope assertion, HTTP payload, or lookup/retry algorithm enters
    the new plan;
  - an action-ID parity test proves that every selected version 1 infrastructure concern maps to
    exactly one version 2 handoff action, with an explicit mapping for renamed IDs;
  - the expected version 1 action IDs are committed as explicit fixture expectations, so the parity
    test remains useful after the version 1 implementation is deleted in Step 4.
- **Verification gate**:
  - focused handoff and generation tests pass for all three fixtures;
  - action-ID parity has zero unmapped selected actions and zero duplicate version 2 actions;
  - sentinel credential values are absent from plan, runbook, and generation receipt;
  - Factory type-check, lint, and pre-commit hooks pass.
- **Expected commits**:
  - `test(factory): pin the complete infrastructure handoff graph`
  - `feat(factory): describe all selected infrastructure externally`
- **Notes**: Provider-specific nouns are allowed because generated code is provider-specific.
  Provider control-plane semantics are not.

### Step 3 - Make legacy operational state locally reportable

- **Goal**: Let doctor explain completed, partial, failed, and malformed legacy state without
  importing a remote executor or implying current provider truth.
- **Depends on**: Step 1
- **TDD mode**: strict
- **Files**:
  - add `tooling/factory/src/legacy-operational-state.service.ts`;
  - add `tooling/factory/src/legacy-operational-state.service.test.ts`;
  - add secret-free fixtures under `tooling/factory/fixtures/legacy/` for succeeded, partial,
    failed, malformed, and plan-mismatched version 1 state;
  - modify `tooling/factory/src/doctor.service.ts`;
  - modify `tooling/factory/src/doctor.service.test.ts`;
  - modify `tooling/factory/src/factory.types.ts` so `DoctorCheck.status` is
    `pass | warning | fail` and `DoctorReport.ok` ignores warnings but not failures.
- **Behavior**:
  - doctor reports legacy file path, lifecycle kind, parse status, recorded status, and matching
    version 2 handoff action IDs when safely knowable;
  - a partial or failed legacy state is an actionable warning and does not invalidate local
    generation integrity;
  - malformed state fails only its legacy-state check and never triggers a retry or provider call;
  - succeeded legacy state is labelled historical and never becomes `remote_verified`;
  - the reader opens files read-only and never renames, rewrites, archives, or deletes them.
- **Verification gate**:
  - every legacy fixture has a behavior assertion rather than a snapshot-only assertion;
  - a filesystem test proves byte-for-byte that doctor leaves legacy files unchanged;
  - a network guard proves all legacy reports are local-only;
  - focused doctor/legacy tests, Factory type-check, lint, and hooks pass.
- **Expected commits**:
  - `test(factory): specify read-only legacy operational reports`
  - `feat(factory): report retired lifecycle state locally`
- **Notes**: Keep only the minimal parsing vocabulary needed for safe reporting. Do not preserve
  executor abstractions merely to reuse their validators.

### Step 4 - Retire generic live provisioning

- **Goal**: Remove the six-provider control plane, apply/resume engine, and authenticated generic
  provisioning commands after their intent and legacy state are covered.
- **Depends on**: Step 2, Step 3
- **TDD mode**: souple
- **Files**:
  - delete `tooling/factory/src/live-provisioning.service.ts` and its test;
  - delete `tooling/factory/src/provisioning-apply.service.ts` and its test;
  - delete `tooling/factory/src/provisioning-plan.service.ts` and its test after version 2 parity is
    proven;
  - delete `tooling/factory/src/provisioning.types.ts` after the legacy reader owns its minimal
    schema;
  - delete `tooling/factory/src/r2-signature.service.ts` if no remaining Factory source imports it;
  - delete `tooling/factory/src/apply.cli.ts`, `apply-live.cli.ts`, `preflight-live.cli.ts`,
    `resume.cli.ts`, `resume-live.cli.ts`, `provisioning.cli.ts`, and
    `live-provisioning.cli.ts`;
  - delete `tooling/factory/src/provisioning.cli.test.ts` and
    `live-provisioning.cli.test.ts` after replacement public-contract tests exist;
  - modify `tooling/factory/src/index.ts` and `tooling/factory/package.json`;
  - modify the generic provisioning sections of `tooling/factory/README.md` and `docs/FACTORY.md`.
- **Behavior**:
  - package scripts no longer expose `apply`, `apply:live`, `preflight:live`, `resume`, or
    `resume:live`;
  - package exports no longer expose adapters, credentials, apply/resume state, simulated apply, or
    version 1 executable planning;
  - the supported replacement is generation plus the version 2 handoff and local doctor;
  - existing remote resources and legacy local files remain untouched.
- **Verification gate**:
  - public-surface tests prove retired scripts and exports are absent and supported local commands
    remain;
  - `rg` finds no `LiveProvisioningAdapter`, `loadLiveProvisioningCredentials`, or generic remote
    apply CLI entrypoint under `tooling/factory`;
  - the fixture matrix from Step 2 still generates and passes doctor;
  - `bun run --cwd tooling/factory test`, `type-check`, and `lint` pass;
  - root `bun run knip` and `bun run build` pass;
  - pre-commit hooks pass;
  - run `void-verify`, then stop at Checkpoint A for human review.
- **Expected commits**:
  - `test(factory): pin the intent-only generic package surface`
  - `feat(factory)!: remove generic live provisioning`
- **Notes**: The breaking-change footer must name removed commands and direct consumers toward
  `.void-starter/provisioning-plan.json` and `docs/PROVISIONING.md`.

## Checkpoint A - after Step 4

The user reviews one generated minimal project and one documents profile, including the version 2
JSON plan, human runbook, doctor output, public scripts, and legacy warning. Stop here, run
`void-verify`, and wait for an explicit signal before retiring the remaining remote lifecycles.

### Step 5 - Replace source publication and migration execution

- **Goal**: Move GitHub publication and production database migration into external handoff actions,
  then remove their Factory executors.
- **Depends on**: Step 4 and Checkpoint A approval
- **TDD mode**: strict
- **Files**:
  - modify the provisioning handoff types, service, tests, generated runbook, and doctor tests;
  - delete `tooling/factory/src/source-publication.service.ts`, its test, and
    `source-publication.types.ts`;
  - delete `source-live.cli.ts`, `source-plan.cli.ts`, `source-preflight.cli.ts`,
    `source-publication.cli.ts`, `source-resume.cli.ts`, `source-update-live.cli.ts`,
    `source-update-preflight.cli.ts`, and `source-update-resume.cli.ts`;
  - delete `tooling/factory/src/migration.service.ts`, its test, and `migration.types.ts`;
  - delete `migration.cli.ts`, `migration-plan.cli.ts`, `migration-preflight.cli.ts`,
    `migration-live.cli.ts`, and `migration-resume.cli.ts`;
  - modify `tooling/factory/src/index.ts`, `tooling/factory/package.json`,
    `tooling/factory/README.md`, `docs/FACTORY.md`, and `docs/SECURITY.md`;
  - modify `bun.lock` only through the human lockfile gate below.
- **Behavior**:
  - the handoff identifies source preparation, repository publication, immutable source digest,
    ordered Drizzle migrations, runtime command, expected commit SHA, and migration completion
    evidence without pushing or opening a database connection;
  - generated-project CI or the operator owns Git, GitHub CLI, database credentials, migration
    execution, retries, and receipts;
  - doctor verifies only local source/migration intent and legacy report structure;
  - `drizzle-orm` and `postgres` are removed from `@repo/factory` dependencies if no retained local
    code needs them.
- **Verification gate**:
  - focused tests prove publication and migration actions are ordered and credential-free;
  - package scripts and exports contain no source/migration live, resume, or preflight executor;
  - generated application migration scripts remain unchanged and pass their existing tests;
  - a human regenerates and reviews `bun.lock` if dependency removal changes it;
  - after the human lockfile commit, frozen install passes;
  - `bun run --cwd tooling/factory test`, `type-check`, and `lint` pass;
  - root `bun run test`, `type-check`, `lint`, `build`, and `knip` pass;
  - pre-commit hooks pass.
- **Expected commits**:
  - `test(factory): specify external source and migration handoffs`
  - `feat(factory)!: retire source and migration execution`
  - `build(factory): remove live-only database dependencies` (human lockfile gate, only if needed)
- **Notes**: Never rewrite or discard an existing migration or publication receipt. The recovery
  guide must instruct operators to inspect remote state before executing a handoff action.

### Step 6 - Replace production auth and delivery execution

- **Goal**: Describe production auth bindings, email setup, deployment observation, and smoke
  criteria without writing Vercel variables, sending mail, or querying Vercel.
- **Depends on**: Step 4 and Checkpoint A approval
- **TDD mode**: strict
- **Files**:
  - modify the provisioning handoff types, service, tests, generated runbook, and doctor tests;
  - delete `tooling/factory/src/auth-production.service.ts`, its test, and
    `auth-production.types.ts`;
  - delete `auth-plan.cli.ts`, `auth-preflight.cli.ts`, `auth-live.cli.ts`,
    `auth-resume.cli.ts`, and `auth-production.cli.ts`;
  - delete `tooling/factory/src/delivery.service.ts`, its test, and `delivery.types.ts`;
  - delete `delivery-plan.cli.ts`, `delivery-preflight.cli.ts`, `delivery-live.cli.ts`,
    `delivery-resume.cli.ts`, and `delivery.cli.ts`;
  - modify `tooling/factory/src/index.ts`, `tooling/factory/package.json`,
    `tooling/factory/README.md`, `docs/FACTORY.md`, `docs/AUTH.md`, and `docs/SECURITY.md`.
- **Behavior**:
  - the handoff preserves required Vercel environment variable names, targets, sensitivity classes,
    canonical URL, sender configuration, bootstrap identity intent, redeployment requirement,
    deployment selection criteria, and HTTP smoke criteria;
  - credential values, remote environment IDs, Resend email IDs, deployment IDs, and HTTP response
    bodies remain external executor state;
  - no Factory success state claims authentication, email, deployment, or smoke is live;
  - generated Better Auth, Clerk, and Resend application code remains unchanged.
- **Verification gate**:
  - auth/delivery handoff tests cover Better Auth + Resend and no-auth profiles;
  - sentinel `VERCEL_TOKEN`, `RESEND_API_KEY`, and `BETTER_AUTH_SECRET` values never enter artifacts;
  - package scripts and exports contain no auth/delivery executor;
  - generated auth applications pass their existing unit and build gates;
  - `bun run --cwd tooling/factory test`, `type-check`, and `lint` pass;
  - root `bun run test`, `type-check`, `lint`, `build`, and `knip` pass;
  - pre-commit hooks pass.
- **Expected commits**:
  - `test(factory): specify external auth and delivery handoffs`
  - `feat(factory)!: retire auth and delivery execution`
- **Notes**: This is security-sensitive despite deleting code. Run the trust-boundary checks against
  the generated plan and runbook before committing.

### Step 7 - Replace EAS project and native-build execution

- **Goal**: Preserve mobile project and native-build intent while removing the Factory's EAS CLI
  control-plane wrapper.
- **Depends on**: Step 4 and Checkpoint A approval
- **TDD mode**: strict
- **Files**:
  - modify the provisioning handoff types, service, tests, generated runbook, and doctor tests;
  - delete `tooling/factory/src/eas-project.service.ts`, its test, and `eas-project.types.ts`;
  - delete `tooling/factory/src/eas-native-build.service.ts`, its test, and
    `eas-native-build.types.ts`;
  - delete `eas-live.cli.ts`, `eas-plan.cli.ts`, `eas-preflight.cli.ts`, `eas-project.cli.ts`,
    `eas-resume.cli.ts`, `eas-build-live.cli.ts`, `eas-build-plan.cli.ts`,
    `eas-build-preflight.cli.ts`, `eas-build-resume.cli.ts`, and `eas-native-build.cli.ts`;
  - delete `tooling/factory/src/eas-project.cli.test.ts` after its public behavior is represented in
    the replacement handoff tests;
  - modify `tooling/factory/src/index.ts`, `tooling/factory/package.json`,
    `tooling/factory/README.md`, and the EAS sections of `docs/FACTORY.md`;
  - retain `tooling/factory/scripts/validate-expo-blueprint.ts` only if it never creates/adopts an
    EAS project, starts a build, or reads `EXPO_TOKEN`.
- **Behavior**:
  - the handoff preserves EAS owner, slug, project-link expectation, selected profile/platforms,
    required environment-variable metadata, immutable source digest, build message, and completion
    criteria;
  - official EAS CLI or project CI owns project initialization, credentials, build start, polling,
    retries, and receipts;
  - generated Expo config and pinned application dependencies remain unchanged;
  - doctor validates local Expo configuration and handoff coverage only.
- **Verification gate**:
  - mobile fixture tests generate complete project/build handoff actions with networking blocked;
  - package scripts and exports contain no EAS live, resume, authenticated preflight, or build
    executor;
  - `rg` proves retained blueprint validation has no EAS control-plane mutation or token read;
  - Expo blueprint validation passes;
  - `bun run --cwd tooling/factory test`, `type-check`, and `lint` pass;
  - root `bun run test`, `type-check`, `lint`, `build`, and `knip` pass;
  - pre-commit hooks pass;
  - run `void-verify`, then stop at Checkpoint B.
- **Expected commits**:
  - `test(factory): specify external EAS project and build handoffs`
  - `feat(factory)!: retire EAS control-plane execution`
- **Notes**: Calling local Expo export or type-check tooling is not remote provisioning. Creating an
  EAS project or build is, even when performed through the official CLI.

## Checkpoint B - after Steps 5, 6, and 7

The user reviews the complete handoff for one web/database/auth/storage profile and one mobile
profile. Confirm that no retired convenience is presented as still supported, that legacy warnings
are actionable, and that all remaining Factory commands are local. Stop and wait for approval before
the final consolidation.

### Step 8 - Consolidate the boundary and prove it cannot silently regrow

- **Goal**: Finish documentation, dependency cleanup, permanent boundary tests, and the durable
  architectural record after every live lifecycle is gone.
- **Depends on**: Steps 5, 6, 7 and Checkpoint B approval
- **TDD mode**: strict
- **Files**:
  - add `tooling/factory/src/intent-only-boundary.test.ts`;
  - modify `tooling/factory/package.json` so only supported local commands remain;
  - modify `tooling/factory/src/index.ts` so only local generation, handoff, doctor, and local
    project-pack/foundation APIs remain;
  - update `tooling/factory/README.md`, `docs/FACTORY.md`, `docs/ARCHITECTURE.md`,
    `docs/SECURITY.md`, and `docs/AUTH.md`;
  - append the approved boundary and rejected alternatives to `docs/DECISIONS.md` using the
    repository's immutable decision-entry convention;
  - update `.void/PROJECT-DOCTRINE.md` only through `void-learn`, with the exact wording shown to and
    approved by the user;
  - modify `bun.lock` only through a human lockfile gate if final dependency cleanup requires it.
- **Behavior**:
  - the supported CLI is reduced to manifest planning, generation, foundation/project-pack local
    application, and local doctor;
  - a permanent test rejects package exports/scripts or source imports that reintroduce remote
    apply, resume, credential loading, provider control-plane clients, or remote truth claims;
  - the test permits provider names, generated runtime integrations, official documentation links,
    and local blueprint validation;
  - all product documentation replaces the one-apply and zero-manual-binding promises with the
    intent-only contract;
  - project doctrine records that live provider execution requires a new approved spec and ADR.
- **Verification gate**:
  - the boundary test fails against a controlled forbidden fixture and passes against the final
    Factory surface;
  - `rg` finds no stale documented command, live export, credential loader, control-plane endpoint,
    or remote success claim in the supported Factory surface;
  - all manifest fixtures generate a version 2 plan and runbook and pass local doctor with networking
    blocked and no credential environment;
  - human-reviewed lockfile changes, if any, pass frozen install;
  - `bun run --cwd tooling/factory test`, `type-check`, and `lint` pass;
  - root `bun run test`, `type-check`, `lint`, `build`, `knip`, and `audit` pass with fresh evidence;
  - pre-commit hooks pass;
  - run `void-code-review` and `void-verify`; no unresolved release blocker remains.
- **Expected commits**:
  - `test(factory): prevent remote execution from re-entering the surface`
  - `docs(factory): record the intent-only product boundary`
  - `feat(factory)!: finish the intent-only Factory surface`
  - `build(factory): remove final live-only dependencies` (human lockfile gate, only if needed)
- **Notes**: Keep boundary enforcement semantic and narrow. A blanket ban on provider names, URLs in
  official documentation, or generated application configuration would block legitimate Factory
  responsibilities and create false positives.

## Final done gate

Before marking the plan done, classify every acceptance criterion in the approved spec as `DONE`,
`CHANGED`, `NOT DONE`, or `UNVERIFIABLE` against the final diff and fresh command output. Remote
resource existence is intentionally `UNVERIFIABLE` and not a deliverable. Record exact test counts,
skipped environment-gated integration tests, build results, Knip result, audit result, hook result,
and the reviewed human lockfile commits. No live canary is part of this product boundary.

Because this plan is `high_risk: true`, run `void-plan-review` before execution. Its security,
engineering, product, and DevEx findings must be disposed in the plan or explicitly rejected with a
reason before Step 1 starts.

## Review checkpoints

| Checkpoint | After | Human review | Continue when |
|---|---|---|---|
| A | Step 4 | Generic infrastructure handoff, legacy warning, removed generic live surface | User explicitly approves remaining lifecycle retirement |
| B | Steps 5-7 | Complete web/mobile handoff and absence of remote executors | User explicitly approves final consolidation |
| Final | Step 8 | Acceptance audit, code review, fresh verification, lockfile provenance | User accepts completion; merge remains human |

## Execution handoff

This is a tracker-backed multi-ticket program. After plan approval, `void-ticket` creates native
tickets with the dependency relations below and installs `.void/active.md`. The tracker then owns
mutable status and next-ready selection; this plan is not updated with a competing next-step pointer.

| Order key | Ticket title | Depends on | Estimate | Human gate |
|---|---|---|---|---|
| F01 | Ship minimal offline provisioning handoff | none | 1 day | plan review before start |
| F02 | Cover complete infrastructure intent graph | F01 | 1.5 days | no |
| F03 | Report legacy operational state locally | F01 | 1 day | no |
| F04 | Retire generic live provisioning | F02, F03 | 1 day | Checkpoint A after completion |
| F05 | Replace source publication and migration execution | F04, Checkpoint A | 1.5 days | lockfile refresh if required |
| F06 | Replace production auth and delivery execution | F04, Checkpoint A | 1.5 days | security review |
| F07 | Replace EAS project and native-build execution | F04, Checkpoint A | 1.5 days | Checkpoint B after F05-F07 |
| F08 | Consolidate and enforce the intent-only boundary | F05, F06, F07, Checkpoint B | 1.5 days | doctrine wording, lockfile if required, final review |

F02 and F03 are independently ready after F01. F05, F06, and F07 are independently ready after
F04 and Checkpoint A. Independence permits flexible ordering but does not authorize autonomous or
parallel execution; execution mode remains a separate human decision.
