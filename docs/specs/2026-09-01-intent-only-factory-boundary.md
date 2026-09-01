---
title: Intent-only Void Starter factory boundary
date: 2026-09-01
status: in-design
author: Florent Pellegrin + Codex
ticket:
related:
  - ../FACTORY.md
  - ../DECISIONS.md
  - ../discovery/2026-07-30/void-music-provisioning-findings.md
  - ../discovery/2026-08-04/session-handoff.md
---

# Intent-only Void Starter factory boundary

## Decision summary

Void Starter will stop owning live provisioning and every other remote mutation lifecycle.

The factory will own:

1. strict manifest validation;
2. deterministic project composition and local generation;
3. a versioned, machine-readable provisioning handoff plan;
4. a human provisioning runbook derived from the same plan;
5. credential-free local verification of generated artifacts and plan integrity.

The factory will not authenticate against, mutate, resume, or certify the live state of a remote
provider. Remote execution belongs to the operator, the generated project's delivery pipeline, an
official provider CLI, or independently maintained infrastructure as code.

This deliberately removes the existing promise that one Factory `apply` produces a deployed
project without manual secret or environment binding. It preserves the higher-value promise: a
selected project is composed deterministically, contains no unselected capability, requires no
credentials to generate, and leaves an explicit handoff with no hidden provisioning work.

## Context and evidence

The current product contract assigns composition, provisioning, configuration, migration,
deployment, and receipts to Void Starter. That boundary produced a capable but open-ended control
plane:

- `tooling/factory/src` contains 91 files and 24,675 lines;
- 8,417 lines are tests and 16,258 are non-test source;
- the remote lifecycle services account for approximately 9,202 non-test lines, compared with
  approximately 3,258 lines for local composition, generation, planning, integrity, project-pack,
  and doctor services;
- the generic live provisioning adapter directly integrates GitHub, Vercel, Neon, Cloudflare,
  Sentry, and PostHog;
- separate live lifecycles add Resend and Expo/EAS, plus source publication, database migration,
  production authentication binding, deployment observation, and native builds.

This is not a code-quality intervention. At the decision point, all 159 Factory tests, TypeScript,
and Biome pass. The issue is ownership economics: provider API versions, permission models, token
scopes, account policies, and ambiguous remote mutations cannot reach a stable completion point
inside this repository.

The strongest observed production evidence is the `void-music` provisioning run: nine actions
eventually succeeded, but required eight manual diagnostic round trips. The following canary then
stopped on an R2 runtime credential scoped to the wrong bucket. The project owner also reports no
new project started through the Factory during the month preceding this decision. The repository
does not independently prove that usage statement, so it is a product signal rather than a code
fact.

## Goals

1. Make the Factory's supported lifecycle finite and maintainable by one project owner.
2. Preserve deterministic, testable, credential-free project generation.
3. Preserve provider intent and cross-resource dependencies without owning provider execution.
4. Make every external action, required input, expected output, and verification signal explicit.
5. Remove live credentials, provider control-plane clients, resume state machines, and remote
   mutation commands from the shipped Factory surface.
6. Leave existing remote resources and legacy receipts untouched and recoverable by an operator.
7. Give generated projects a clear path to official CLIs or external infrastructure as code without
   claiming those tools are part of the Factory guarantee.

## Non-goals

This change will not:

- build or maintain a Terraform, OpenTofu, Pulumi, or provider-specific IaC executor;
- wrap official provider CLIs in a new Factory execution layer;
- retain compatibility for `*:live`, `*:resume`, or authenticated `*:preflight` commands;
- detect remote drift or prove that a provider resource currently matches the plan;
- migrate, repair, rotate, or delete any existing remote resource or credential;
- make the manifest provider-agnostic;
- remove provider SDKs or runtime integrations from generated applications;
- change the generated application's responsibility to validate its own runtime environment at
  boot;
- solve deployment orchestration for every possible hosting or mobile provider.

Generating an executable IaC project is a separate product decision. It would transfer much of the
provider implementation to maintained plugins, but the Factory would still own module composition,
provider versions, state conventions, upgrades, and compatibility. It must not enter this scope by
accident.

## Ownership boundary

| Concern | Void Starter owns | External owner |
|---|---|---|
| Product selection | Manifest schema and validation | Product author chooses values |
| Source tree | Deterministic composition and generation | Consumer owns later edits |
| Provider intent | Desired resources, constraints, dependencies, and required outputs | Operator chooses execution mechanism |
| Credentials | Names and purpose only; never values or validation | Operator, secret manager, provider CLI, or IaC |
| Resource creation | No execution | Official CLI, dashboard, generated-project CI, or IaC |
| Environment binding | Required variable names, targets, and sensitivity classification | Deployment platform or IaC |
| Database migration | Ordered migration handoff and application command | Generated-project CI or operator |
| Source publication | Ordered handoff and expected repository state | Git and official hosting CLI |
| Deployment and native build | Required inputs, command handoff, and success criteria | Vercel/EAS tooling or project CI |
| Verification | Local hashes, schemas, composition, and plan completeness | Provider truth and remote drift |
| Receipts | Generation and plan digests | Remote executor owns its state and receipts |

No Factory success status may imply that a remote resource exists. Vocabulary must distinguish
`local_ready` from externally provisioned, deployed, migrated, or verified states.

## Output contracts

### Machine-readable handoff plan

Generation produces `.void-starter/provisioning-plan.json` with `schema_version: 2` and an explicit
`execution_owner: external` marker. It replaces the current executable apply plan as the supported
provisioning contract. Version 2 is a clean semantic break: version 1 described actions the Factory
could execute, while version 2 describes actions an external owner must execute.

For every selected external concern, the plan records:

- a stable action ID;
- provider and resource kind;
- desired non-secret state;
- dependencies on other actions;
- required non-secret account coordinates;
- required credential names and their purpose, never values;
- required generated-project environment variable names, targets, and sensitivity class;
- recommended execution mechanism, such as an official CLI, dashboard, project CI, or external IaC;
- expected non-secret outputs needed by dependent steps;
- observable completion criteria;
- recovery or rollback guidance when partial execution is possible.

The plan must remain deterministic for the same normalized manifest, non-secret context, and
Factory version. Its digest is included in the generation receipt. An external tool may consume the
plan, but no such consumer is shipped or certified by this specification.

The plan may contain provider-specific nouns and constraints because generated code is already
provider-specific. It must not contain provider API endpoints, request payloads, response schemas,
access tokens, secret values, or a claim that an action is currently executable.

### Human runbook

Generation also produces `docs/PROVISIONING.md` from the same normalized plan. It is an ordered,
human-readable handoff rather than a second source of truth.

Each step includes:

1. why the resource or binding is required;
2. which external owner performs it;
3. the recommended official tool category;
4. the non-secret inputs and secret names required;
5. the expected non-secret outputs;
6. how the operator observes completion;
7. what can be safely retried and what requires inspection first.

Exact provider commands may be included as version-labelled examples. They are guidance, not an
execution guarantee, and must link to the provider's official documentation. The JSON plan remains
authoritative when prose and structure disagree.

### Doctor contract

`doctor` remains credential-free and local. It verifies:

- the manifest and generation receipt parse against supported schemas;
- generated files match their recorded digests;
- selected surfaces and capabilities match the manifest;
- unselected modules and development-only Factory artifacts are absent;
- the handoff plan matches the manifest and generation receipt;
- the runbook covers every ordered action in the handoff plan;
- the schemas expose no field that accepts a provider credential value;
- legacy operational state is recognized and reported without being treated as remote truth.

`doctor` must not call provider APIs, invoke provider CLIs, require credentials, or report remote
resources as verified. Runtime environment validation remains inside the generated application via
its Zod environment boundary. Remote health checks belong to the generated project's own CI or
operations surface.

## Supported lifecycle

The supported flow becomes:

```text
Forge manifest
  -> Factory validation
  -> deterministic local generation
  -> provisioning intent plan + runbook
  -> credential-free local doctor
  -> external execution and receipts
  -> generated-project runtime checks
  -> Void Harness for ongoing implementation discipline
```

Repeated validation, generation planning, or doctor execution has no remote side effect. Running
the supported flow with networking disabled and an empty credential environment produces the same
local artifacts as an online run, assuming repository dependencies are already installed.

## Shipped surface changes

The Factory retains local commands for manifest planning, generation, project-pack application,
foundation composition, and doctor.

The Factory removes or makes unavailable from package exports and scripts:

- the multi-provider live provisioning adapter and credential loader;
- live apply, live resume, simulation apply, and authenticated provider preflight;
- GitHub source publication and source update execution;
- direct Neon migration execution;
- Vercel/Resend production authentication binding and email smoke execution;
- EAS project creation/adoption and native build execution wrappers;
- provider-specific delivery observation presented as a Factory lifecycle;
- operational locks, retry state machines, and mutation receipts used only by those commands.

The existing family of separate source, migration, delivery, auth, EAS project, and EAS build plans
is consolidated into the single handoff plan. This prevents the planning surface from preserving
the same product fragmentation after execution is removed.

Provider-specific runtime modules and generated application configuration remain. Cutting remote
provisioning does not remove Clerk, Sentry, PostHog, Resend, R2, Stripe, Payload, Upstash, Expo, or
other selected application integrations from generated output.

## Legacy state and recovery

Existing `.void-starter` operational state files are never deleted or rewritten automatically.

When `doctor` finds one, it reports:

- that the receipt came from a retired execution lifecycle;
- its structural status when it can be parsed safely;
- that the Factory no longer resumes or certifies it;
- the matching handoff-plan actions an operator must inspect before continuing externally.

A partial legacy apply must not cause local generation integrity to fail. It produces an actionable
warning because remote state may exist and blind recreation could duplicate or overwrite it.

The migration documentation must cover the known `void-music` and interrupted canary shapes without
containing provider IDs or credentials. Cleanup of sandbox resources remains a separate, explicitly
authorized operation and is never performed during this change.

## Failure semantics

- An unsupported selected capability fails plan generation with a precise manifest path. The
  Factory never silently omits an external action.
- Missing non-secret account coordinates fail plan generation before files are written.
- Missing credential values never fail Factory generation or doctor because the Factory does not
  accept them.
- A missing recommended external tool is reported in the runbook, not installed or invoked.
- Duplicate Factory runs reproduce the same plan and do not touch remote state.
- A legacy failed or partial receipt produces a warning with manual recovery guidance, not a false
  success or automatic retry.
- A runbook action without a matching machine-plan action, or the reverse, fails doctor.
- Remote executor failures are outside the Factory error model and must remain visible in that
  executor's own logs and state.

## Security and privacy constraints

- No Factory command accepts, loads, validates, logs, hashes, or persists provider credential
  values.
- The plan may name required secrets but never include examples resembling real values.
- No remote state file is copied into a newly generated project unless it is part of the local
  generation contract.
- Generated runbooks must not interpolate current process environment values.
- Existing secret-redaction tests remain until all credential-bearing paths they protect are
  removed; replacement tests prove the new artifacts are secret-free.
- The implementation must not remove or rotate remote credentials as part of retiring the code.

## Testing strategy

### Contract-first tests - strict TDD

Write failing tests for the new observable contract before production changes:

- one representative web manifest produces a complete handoff plan and runbook;
- one mobile manifest includes EAS project and build handoffs without invoking EAS;
- one database/auth/storage manifest preserves cross-action dependencies and required bindings;
- the same inputs produce byte-identical plans and matching digests;
- generation and doctor pass with networking disabled and no credential environment;
- every machine action appears exactly once in the runbook;
- unsupported intent fails explicitly rather than disappearing;
- generated artifacts contain no supplied sentinel secret value.

### Surface retirement - souple TDD

Use characterization tests to preserve local generation output while remote entrypoints are removed.
Tests assert that package scripts and exports no longer expose live, resume, credential-loading, or
remote apply behavior. Tests must exercise public behavior rather than snapshot deleted internals.

### Legacy reporting - strict TDD

Fixtures cover succeeded, failed, partial, malformed, and plan-mismatched legacy state. Doctor must
distinguish local integrity from retired remote state and never claim current provider truth.

### Repository verification

The final verification gate includes Factory lint, type-check, tests, build, Knip, and the root
repository equivalents. At least the existing manifest fixture matrix must generate, plan, and pass
doctor with no provider credentials. No live canary is required because the supported product no
longer performs live execution.

## Rollout

### Phase 1: establish the replacement contract

Add the unified handoff-plan schema, deterministic runbook generation, and doctor coverage while the
old live implementation still exists internally. The new path becomes the documented default.

### Phase 2: retire the live public surface

Remove live, resume, simulation-apply, and authenticated preflight scripts and exports. Remove
direct provider clients and remote execution services once their plan-only information has moved
into the handoff contract.

### Phase 3: preserve local compatibility

Teach doctor to report legacy receipts without remote validation. Publish the recovery guide for
projects with completed or partial legacy state. Do not mutate those projects or their providers.

### Phase 4: align product documentation

Update `docs/FACTORY.md`, the Factory README, security documentation, architecture documentation,
and decisions. Remove the promises of one approved live apply and zero manual environment binding.
Record the new boundary in an immutable ADR and the project doctrine after explicit human approval.

### Phase 5: delete obsolete complexity and verify

Delete dead credential, HTTP adapter, locking, resume, remote receipt, and live CLI code. Run the
complete fixture and repository verification gates on the resulting surface.

## Acceptance criteria

The change is complete when all of the following are observed:

1. `@repo/factory` exposes no remote apply, resume, credential-loading, or provider control-plane
   client API.
2. `tooling/factory/package.json` exposes no live or remote-resume scripts.
3. The supported manifest-to-generate-to-plan-to-doctor path succeeds with no provider credentials
   and with provider networking unavailable.
4. Every selected external concern appears in one deterministic handoff plan and exactly once in
   its generated runbook.
5. No Factory success status claims that a remote resource exists, is configured, or is healthy.
6. Doctor performs no provider request and invokes no provider CLI.
7. Existing operational state is left untouched and receives an actionable legacy report.
8. Generated application code, selected provider integrations, and local quality gates retain their
   previous behavior unless this specification explicitly changes it.
9. Factory and root lint, type-check, tests, build, and Knip pass with fresh evidence.
10. `docs/FACTORY.md` and related documentation describe the intent-only boundary without retaining
    the retired zero-copy or one-apply promise.

## Alternatives considered

### Keep read-only provider verification

This would remove mutations while retaining authenticated preflight and remote doctor checks. It was
rejected as the target boundary because response schemas, scopes, account policies, endpoints, and
provider availability would remain an open-ended Factory responsibility. It may be useful during
migration but must not remain in the supported final surface.

### Keep live apply for a small core provider set

This would preserve the strongest convenience for GitHub, Vercel, and Neon while dropping the long
tail. It was rejected because no stable principle makes those APIs the Factory's responsibility and
the cross-provider bindings still carry the same permission and reconciliation failure modes.

### Generate and own complete infrastructure as code

This is the most ambitious version: the Factory emits an executable project whose providers perform
reconciliation. It is credible but not free. Provider plugins absorb HTTP details, while Void
Starter still owns state, module composition, upgrades, imports, secrets, and destructive-change
review. It remains a possible later product, behind separate evidence and a separate specification.

## Approval gate

No implementation starts until this specification is explicitly approved. After approval, the only
next workflow is `void-plan`, which will decompose the migration into reversible vertical slices and
name the exact legacy compatibility and deletion checkpoints.
