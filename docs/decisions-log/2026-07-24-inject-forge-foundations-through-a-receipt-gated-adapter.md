---
date: 2026-07-24
title: "Inject Forge foundations through a receipt-gated adapter"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Inject Forge foundations through a receipt-gated adapter

- **Date:** 2026-07-24
- **Decision:** Consume `forge/project-pack-v1` through a dedicated `foundation
  preview|apply|check` lifecycle, separate from fresh generation and provider provisioning.
  Preview and check are non-mutating. Apply requires the exact Forge project id, validates all 14
  source hashes and path boundaries, takes a local lock, recomputes the plan under that lock, and
  writes a canonical per-file receipt at `.void-starter/project-pack-receipt.json`. Initial writes
  are create-only. A later write is allowed only when the destination hash matches the previous
  receipt. Any unmanaged, missing, locally modified, or symlinked destination blocks the complete
  transaction without overwriting. The adapter stages writes and rolls committed files back if a
  later commit step fails.
- **Why:** Forge foundations must survive into design and code without making `.forge` compete with
  hand-maintained project documentation. Blind copying loses ownership, silently destroys local
  decisions, and makes two linked repositories drift. A receipt gives every destination an
  explicit provenance and expected hash while keeping the source contract owned by Forge.
- **Rejected alternatives:**
  - Copy the pack with overwrite enabled: destroys local edits and provides no merge evidence.
  - Put foundation injection inside `generate`: excludes existing repositories and couples product
    memory to baseline rendering.
  - Put foundation injection inside provisioning `apply`: mixes local documents with credentialed,
    billable remote mutations.
  - Adopt an existing destination on first apply when contents happen to match: provenance is still
    unknown, so later replacement would be unsafe.
  - Extract a shared contract package now: there is one producer and one executable consumer. The
    consumer compatibility boundary plus real-output dogfood is smaller until Forge's extraction
    thresholds are reached.
- **When to revisit:** When Project Pack gains a second executable consumer, a second producer, or
  frequent breaking changes. At that point extract a single owned schema package and migrate both
  repositories instead of maintaining another mirror.
