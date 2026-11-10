---
date: 2026-07-26
title: "Accept EAS project provisioning after guarded publication"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Accept EAS project provisioning after guarded publication

- **Date:** 2026-07-26
- **Decision:** Accept the Expo/EAS identity tranche after an isolated organization canary created
  and verified the exact `@account/slug`, wrote only the public UUID link, adopted the existing
  GitHub/Vercel/Neon resources from a fresh generated target, published that link as one guarded
  fast-forward, passed the complete quality and E2E workflow, and smoked the deployment for the
  exact source commit through Vercel protection. Require EAS initialization to run from a
  provider-owned temporary project containing a minimal `package.json` and an identity-only static
  Expo config. Surface redacted provider diagnostics only in process memory; keep receipts generic,
  mode `0600` and secret-free.
- **Why:** Contract mocks proved idempotence but could not prove EAS CLI's project-root discovery,
  config evaluation, robot-role behavior or the final Git/CI/deployment chain. The first two live
  attempts exposed two boundary assumptions: EAS requires a package root, and the isolated config
  must not carry runtime-only plugins into a dependency-free provider directory. The third attempt
  created and read back the UUID, while guarded source resume reconciled GitHub's temporarily stale
  post-push read without a second commit. The resulting CI build proves the checked-in overlay is
  consumable by the real Expo application rather than only by Factory tests.
- **Rejected alternatives:**
  - Run initialization directly in `apps/mobile`: lets EAS mutate receipt-owned generation output.
  - Copy the complete mobile dependency graph into the provider directory: couples identity
    creation to runtime install state and makes the isolated boundary misleading.
  - Treat project creation alone as acceptance: does not prove the UUID overlay survives source
    publication, CI config evaluation or a fresh Production deployment.
  - Persist raw EAS stderr for debugging: provider output is not a safe long-term receipt format.
- **When to revisit:** Add a separate guarded EAS environment/build lifecycle only when a real
  mobile product supplies runtime-secret requirements, target platforms, signing ownership, store
  memberships and explicit cost approval. Re-run this canary after material EAS CLI project-init or
  Expo configuration changes.
