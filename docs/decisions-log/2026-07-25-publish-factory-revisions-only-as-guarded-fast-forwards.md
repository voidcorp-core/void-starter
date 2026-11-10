---
date: 2026-07-25
title: "Publish Factory revisions only as guarded fast-forwards"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Publish Factory revisions only as guarded fast-forwards

- **Date:** 2026-07-25
- **Decision:** Add a separate `source:update:preflight|live|resume` lifecycle for refreshing a
  Factory-owned repository from a fresh generated target. Require that target to adopt the
  existing infrastructure first. Treat the current remote `main` commit SHA, tree SHA and source
  marker as the immutable update base. Fetch and verify that exact base, create one child commit,
  recheck the remote immediately before mutation, and push only as a normal fast-forward.
  Treat an immediate post-push read of that same old base as a retryable unconfirmed mutation;
  `resume` reconciles the new exact child once GitHub exposes it.
- **Why:** Initial publication intentionally rejects different remote content, but the first live
  canary exposed fixes that must be delivered without bypassing the receipt and credential
  boundaries. A remote source marker alone is insufficient if another commit lands between
  preflight and push. Binding the plan to the complete HEAD identity and retaining Git's
  fast-forward check protects both provenance and concurrency.
- **Rejected alternatives:**
  - Force-push the corrected generated tree: can erase user work or concurrent automation.
  - Relax initial-source adoption to accept any marked history: conflates bootstrap and updates,
    weakening the simpler empty/exact contract.
  - Copy files and run an ad-hoc authenticated push for the canary: proves neither a reusable
    product path nor safe resume behavior.
- **When to revisit:** Add a merge-aware upgrade workflow only when real generated repositories
  need to preserve user changes while accepting template revisions. Keep that separate from this
  exact-snapshot fast-forward lane.
