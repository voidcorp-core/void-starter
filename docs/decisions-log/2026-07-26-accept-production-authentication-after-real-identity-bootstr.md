---
date: 2026-07-26
title: "Accept production authentication after real identity bootstrap"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Accept production authentication after real identity bootstrap

- **Date:** 2026-07-26
- **Decision:** Accept the Better Auth production tranche after an isolated canary bound all eight
  planned Vercel Production variables, delivered the idempotent Resend configuration message from
  a verified subdomain, redeployed the exact source commit, passed the protected HTTP smoke and
  completed a real magic-link session for the exact bootstrap identity. Require `/admin` to report
  that identity with role `admin`, the auth/delivery/migration receipts to pass `doctor`, every
  receipt to remain mode `0600`, and the publishable source digest to remain unchanged.
- **Why:** Provider-mocked environment writes and email responses cannot prove Resend domain/key
  alignment, Vercel's post-binding deployment semantics, Better Auth callback URLs, cookie/session
  creation, database user hooks or the final authorization policy. The complete browser flow proves
  that the configured human identity, rather than an invented seed credential, receives the first
  administrator role across the real provider chain.
- **Rejected alternatives:**
  - Stop after the configuration email: proves Resend sending, not Better Auth's callback or role
    hook.
  - Inspect the database role directly without signing in: proves stored data, not session and
    route authorization.
  - Reuse the pre-binding deployment: Vercel does not inject changed variables retroactively.
  - Persist the magic link, provider tokens or secret values as evidence: turns authentication
    validation into credential disclosure.
- **When to revisit:** Add an automated authenticated-route receipt only if a short-lived canary
  identity can be exercised without persisting bearer links or session credentials. Re-run the
  live canary after Better Auth, Resend or Vercel environment contracts change.
