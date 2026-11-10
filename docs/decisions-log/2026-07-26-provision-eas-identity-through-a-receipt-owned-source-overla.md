---
date: 2026-07-26
title: "Provision EAS identity through a receipt-owned source overlay"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Provision EAS identity through a receipt-owned source overlay

- **Date:** 2026-07-26
- **Decision:** Add a separate `eas:plan|preflight|live|resume` lifecycle for Expo projects. Keep
  only the Expo account in a strict non-secret context and read `EXPO_TOKEN` from process memory.
  Execute pinned `eas-cli@21.2.0` in an isolated temporary static config to create or adopt the
  exact `@account/slug`, verify its UUID through `project:info`, then write a public non-secret
  `apps/mobile/eas-project.json`. Have a stable generated `app.config.ts` consume that file while
  leaving generation-owned `app.json` byte-for-byte unchanged. Persist the operational plan and
  link digest in ignored mode-`0600` state, and make `doctor` reject unowned links. Do not start a
  native build or create signing/store credentials in this lifecycle.
- **Why:** EAS requires `extra.eas.projectId` in evaluated app configuration, but the ID exists only
  after a remote project is created. Letting the provider CLI rewrite `app.json` would invalidate
  the generation receipt and blur the boundary between deterministic template output and remote
  identity. The small checked-in overlay is non-secret, reproducible on fresh renders, and can be
  included in the next guarded source update. EAS uniqueness by account and slug also lets resume
  adopt an ambiguously created project rather than duplicate it. This follows Expo's
  [programmatic token](https://docs.expo.dev/accounts/programmatic-access/) and
  [EAS CLI project initialization](https://github.com/expo/eas-cli#eas-init) contracts.
- **Rejected alternatives:**
  - Run `eas init` directly in the generated mobile directory: allows an external CLI to mutate a
    receipt-owned file and potentially leave partial local changes.
  - Put the project ID or account into manifest v1 before creation: the UUID does not exist at
    intent time, and provider coordinates do not belong in product capability intent.
  - Pass the project ID only through an environment variable: makes every local, CI and remote EAS
    command depend on undeclared ambient configuration for a non-secret identity.
  - Install EAS CLI in the generated workspace: reintroduces the dependency and vulnerability
    graph already removed by decision 45.
  - Combine project creation with `eas build`: mixes a free identity mutation with signing,
    platform membership, build cost and store credentials that require separate approval.
- **When to revisit:** Accept the lifecycle only after an isolated live create/adopt/resume canary
  and a guarded source update prove current Expo behavior. Add EAS environment bindings and native
  build receipts only when the first mobile product defines its runtime secrets, platform target
  and signing ownership.
