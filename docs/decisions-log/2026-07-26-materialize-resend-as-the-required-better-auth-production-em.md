---
date: 2026-07-26
title: "Materialize Resend as the required Better Auth production email adapter"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Materialize Resend as the required Better Auth production email adapter

- **Date:** 2026-07-26
- **Decision:** Promote `_modules/email-resend` from a README placeholder to a real server-only
  workspace selected by `operations.email: resend`. Route Better Auth verification, password reset
  and magic links through its direct Resend HTTPS adapter. Require Resend whenever Better Auth is
  selected, but retain local console links only when both sender variables are absent. Partial
  configuration and every unconfigured production send fail closed. Use text plus escaped HTML,
  bounded requests and deterministic Resend idempotency keys; never surface provider bodies or
  credentials in errors.
- **Why:** A production authentication profile that throws for every email is not turnkey, and
  implementing only magic links would leave verification and the existing reset UI broken. A
  direct HTTPS adapter keeps the dependency and browser bundle at zero while covering Resend's
  stable send-email contract. Requiring the adapter at manifest validation makes the declared
  production baseline truthful.
- **Rejected alternatives:**
  - Keep the placeholder and configure email manually per project: recreates drift and cannot be
    verified by generated-project tests.
  - Add only the Resend SDK: adds a supply-chain dependency for one stable HTTP endpoint without
    improving the local contract.
  - Fall back to URL logging in production: leaks bearer-style authentication links and masks a
    broken product flow.
  - Await a React Email design system: blocks functional delivery on presentation work; the
    adapter already has accessible HTML and text bodies and can adopt richer templates later.
- **When to revisit:** Adopt React Email when multiple branded transactional templates justify the
  dependency. Replace Resend only through the same three-purpose server port and manifest adapter.
