---
status: executing
program: intent-only-factory-boundary
plan: docs/plans/2026-09-01-intent-only-factory-boundary-plan.md
spec: docs/specs/2026-09-01-intent-only-factory-boundary.md
tracker:
  provider: linear
  scope: project:e593ab7d-2c0d-45ad-8810-828fe76aa022
  issues: [DEV-685, DEV-687, DEV-686, DEV-688, DEV-689, DEV-690, DEV-691, DEV-692]
  readyStates: [Backlog, Todo]
  startedState: In Progress
  reviewState: In Review
  doneStates: [Done]
humanGates: [DEV-688, DEV-691, DEV-692]
autopilot:
  schemaVersion: 1
  enabled: true
  clusterSize: 3
  base: main
  mergeGate: human
  verifyCommands:
    - [bun, install, --frozen-lockfile]
    - [bun, run, audit]
    - [bun, run, lint]
    - [bun, run, type-check]
    - [bun, run, test]
    - [bun, run, build]
    - [bun, run, knip]
  ownership:
    sequential: [tooling/factory/, docs/, .void/]
    reconcileOnly: [.void/active.md]
---

# Intent-only Factory boundary

The linked plan supplies the program's global intent, sequencing, verification gates, and review
checkpoints. Each complete Linear issue is the executable unit, and its native blocker relations
decide readiness. The ordered `tracker.issues` list is only the deterministic tie-break order among
simultaneously ready issues; it does not record mutable progress.

`void-implement` owns each ticket's lifecycle, evidence, and tracker updates. The all-lenses plan
review is cleared. DEV-688 closes Checkpoint A; DEV-691 closes Checkpoint B only after DEV-689 and
DEV-690 are also done; DEV-692 carries the final doctrine, lockfile, verification, and acceptance
gates. Every remaining gate requires explicit human approval.

Autopilot execution is enabled and sequential for every planned Factory, documentation, and active
program path. Lockfile changes, checkpoint continuation, and merge remain human-controlled.
