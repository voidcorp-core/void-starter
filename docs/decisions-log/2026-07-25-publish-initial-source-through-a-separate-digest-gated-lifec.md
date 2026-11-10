---
date: 2026-07-25
title: "Publish initial source through a separate digest-gated lifecycle"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-25: Publish initial source through a separate digest-gated lifecycle

- **Date:** 2026-07-25
- **Decision:** Keep initial Git source publication separate from infrastructure provisioning.
  Require a successful live provisioning receipt and generated `bun.lock`; compute a SHA-256 plan
  over the exact publishable files; exclude operation state, secrets, caches and build output; and
  publish one root commit to `main` through Git HTTPS. Attribute the commit to the authenticated
  GitHub user's noreply identity. Pass the fine-grained token only through a temporary askpass
  environment with credential helpers disabled. Persist a separate atomic
  `.void-starter/source-state.json`. Adopt an existing branch only when both its factory source
  marker and exact Git tree match; otherwise fail closed.
- **Why:** Adding source to the already completed provider action plan would invalidate valid live
  state. A separate plan can include the post-install lockfile and exact source digest, neither of
  which exists when the infrastructure plan is derived from the build manifest. Git remotes that
  embed a token and ordinary credential helpers can persist secrets. Vercel Pro also checks commit
  authors on connected private organization repositories, so a made-up factory identity can block
  automatic deployment.
- **Rejected alternatives:**
  - Widen the first provisioning plan: breaks resume for the already validated provider receipt
    and still cannot derive the post-install lockfile digest from manifest intent.
  - Store a token in the remote URL: leaks it through `.git/config`, diagnostics and process
    inspection.
  - Force-push or adopt same-name content: can destroy or silently claim unrelated work.
  - Push without a lockfile: makes CI and Vercel dependency resolution non-reproducible.
- **When to revisit:** Replace the personal token with a short-lived GitHub App installation token
  for long-lived automation. Extend delivery with separate migration, deployment observation and
  smoke-test receipts after the source canary passes.
