---
date: 2026-07-25
title: "Keep Factory discovery and implementation history out of generated repositories"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Keep Factory discovery and implementation history out of generated repositories

- **Date:** 2026-07-25
- **Decision:** Exclude `docs/discovery` and `docs/superpowers` from every generated repository,
  record both paths in the generation receipt, and make `doctor` reject them as development
  artifacts if they reappear. Keep reusable product documentation such as architecture, auth,
  security, CI and decisions in the generated project.
- **Why:** The live canary correctly excluded Harness, Factory code and agent governance, but a
  final output inspection found sandbox handoffs and historical implementation plans in the
  published application repository. They contained no secrets, yet exposed control-plane IDs and
  irrelevant development history. Template isolation includes operational context, not only
  executable dependencies.
- **Rejected alternatives:**
  - Leave the documents because they are harmless Markdown: generated repositories should not
    inherit Factory-specific history or sandbox identifiers.
  - Remove all documentation: discards useful product contracts that belong in the application.
  - Rewrite individual handoffs during generation: brittle content filtering is weaker than a
    path-level ownership boundary.
- **When to revisit:** Promote a document into the generated set only after rewriting it as
  reusable project documentation without Factory- or sandbox-specific state.
