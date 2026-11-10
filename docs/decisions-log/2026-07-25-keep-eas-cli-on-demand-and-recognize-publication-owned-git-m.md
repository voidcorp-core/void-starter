---
date: 2026-07-25
title: "Keep EAS CLI on demand and recognize publication-owned Git metadata"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Keep EAS CLI on demand and recognize publication-owned Git metadata

- **Date:** 2026-07-25
- **Decision:** Keep the Expo SDK and EAS profiles in generated projects, but execute the pinned
  EAS CLI on demand through `bunx eas-cli@21.2.0` instead of installing it in every mobile
  workspace. Override `uuid` to the first non-vulnerable compatible release required by the
  current Expo graph. Let `doctor` accept a local `.git` directory only when a structurally valid
  source-publication receipt exists and matches the current source snapshot.
- **Why:** The first source canary reached GitHub, then CI failed exclusively because the latest
  EAS CLI pinned seven vulnerable transitive packages into the application lockfile even though
  CI, local Expo development and static export never invoke EAS. Removing that operational CLI
  reduced the generated graph from 1,200 to 930 packages while the complete Next.js and Expo
  builds remained green. The same canary also showed that the source lifecycle creates legitimate
  Git metadata after `doctor` has already proved generation isolation; continuing to classify
  that receipt-owned `.git` as copied development governance is a false positive.
- **Rejected alternatives:**
  - Disable or weaken `bun audit`: hides actionable application dependency findings.
  - Force all vulnerable transitive packages through global breaking-major overrides: can silently
    break unrelated Expo and build-tool consumers.
  - Always permit `.git`: loses the guarantee that generation never copied source-repository
    metadata.
- **When to revisit:** Install EAS CLI in the workspace again only if Expo publishes a
  vulnerability-clean graph and local reproducibility materially benefits. Replace the `uuid`
  override when the supported Expo SDK resolves a fixed release natively.
