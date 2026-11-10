---
date: 2026-07-24
title: "Evolve the starter into a manifest-driven project factory"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: Evolve the starter into a manifest-driven project factory

- **Date:** 2026-07-24
- **Decision:** Preserve the current Next.js monorepo as the proven web baseline, then add a
  manifest-driven factory that composes only the surfaces and capabilities a project selects.
  Forge produces product intent and a versioned build manifest. Void Starter plans, provisions,
  configures, migrates, deploys and returns a receipt. Void Harness governs the implementation
  that follows while remaining external development tooling: no Harness files, hooks, skills,
  configuration or package dependencies are copied into generated repositories. Expo is an
  optional surface in the same factory, not a permanent dependency of every generated repository.
  Provider routing is workload-aware and Vercel-first, not Vercel-only. The full target contract
  lives in `docs/FACTORY.md`.
- **Why:** The current quickstart still requires manual GitHub, Vercel, Neon, environment,
  migration, email and administrator work before product development starts. Copying every
  possible surface or module into every repository would replace manual wiring with permanent
  complexity. A typed manifest plus idempotent `plan/apply/resume/doctor` lifecycle automates the
  setup while keeping generated outputs minimal and auditable.
- **Rejected alternatives:**
  - Keep the repo as a clone-only template and improve the README: documents the work but does
    not remove it or make it resumable.
  - Always include Expo, workers and every integration: maximizes unused dependencies, CI time
    and upgrade surface.
  - Embed Void Harness in the template or generated output: couples application source to
    development governance and makes every generated project carry tooling it did not select.
  - Make tRPC mandatory to unify web and mobile: protocol choice should follow the surface and
    workload; REST/OpenAPI, Server Actions, SSE and WebRTC have distinct jobs.
  - Move all workloads away from Vercel: loses the best Next.js integration without solving a
    universal problem. Persistent and realtime workloads can route elsewhere selectively.
- **When to revisit:** If fixture-generated projects become harder to maintain than the baseline,
  if provider APIs make reliable idempotence impossible, or if Forge cannot express project
  requirements without leaking provider implementation details.
