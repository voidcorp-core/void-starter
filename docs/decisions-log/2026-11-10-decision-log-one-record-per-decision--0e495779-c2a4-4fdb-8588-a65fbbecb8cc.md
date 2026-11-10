---
schemaVersion: 1
id: "adr:0e495779-c2a4-4fdb-8588-a65fbbecb8cc"
createdAt: "2026-11-10T18:18:40.670Z"
title: "Move the decision log to one immutable record per decision"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Move the decision log to one immutable record per decision

## Context

The starter logged its 73 decisions in a single append-only `docs/DECISIONS.md`. The harness
(void-machine 7) reads decisions only from one immutable file per record under
`docs/decisions-log/`, and `void-machine doctor` flagged the single file as unread. A single file
also turns two concurrent pull requests that each add a decision into a merge conflict on the
same tail of the file, and its append-only rule rests on discipline alone.

## Decision

Every new decision is a new file under `docs/decisions-log/`, created with
`void-machine decisions new`; `docs/DECISIONS.md` stays as a frozen snapshot of ADRs 1 to 73.

## Consequences

Positive:

- The harness skills (`void-decide`, reviews, autopilot) read the project's decisions.
- Two branches adding a decision no longer conflict, and `void-machine decisions check --base`
  can prove that an existing record was not edited.

Negative:

- The 73 migrated records carry no ADR number. Existing "ADR NN" and "entry NN" references in the
  docs and code comments keep resolving through the frozen snapshot, which therefore stays in the
  repo rather than being deleted.

## Alternatives considered

- Keep `docs/DECISIONS.md` as the living log: rejected because the harness does not read it, so
  every harness-driven review would decide without the project's settled trade-offs.
- Migrate and delete `docs/DECISIONS.md`: rejected because roughly fifty references across the
  docs, module READMEs and source comments cite decisions by number, and rewriting them all buys
  nothing a frozen snapshot does not already give.

## Reversal cost

Low. The records are plain Markdown with front matter, and `void-machine decisions render`
regenerates a single-file projection at any time.
