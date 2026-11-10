---
date: 2026-07-29
title: "Make test clients speak the transport, and prove a refusal came from the rule"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-29: Make test clients speak the transport, and prove a refusal came from the rule

- **Date:** 2026-07-29
- **Decision:** Every request a test harness sends to an authentication endpoint goes through one
  helper that sends what a real client sends -- today an `Origin` header matching the base URL the
  run targets -- and every refusal is asserted with a helper that rejects the transport refusal
  codes (`MISSING_OR_NULL_ORIGIN`, `INVALID_ORIGIN`,
  `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`). A refusal counts as evidence only once it is shown to be
  the application's.
- **Why:** Better Auth validates the origin of any request that carries a cookie
  (`validateOrigin` reads `headers.has('cookie')` and then demands `Origin` or `Referer`). Playwright's
  `APIRequestContext` sends neither. The fixtures were therefore correct for exactly as long as they
  carried no cookie, and ADR 65 gave them one: from that commit on, every sign-up POST was refused
  with 403 before reaching the admission rule. Four refusal specs kept passing, because
  `response.ok() === false` is true for a CSRF refusal too, so they asserted nothing about the
  contract they were named for. Only the admission spec went red, which is what made a correct rule
  look broken for a second canary round trip. The same shape as the cookie-jar false lead that
  preceded it: a harness that is not built like a client produces green that means nothing.
- **Rejected alternatives:**
  - Disabling the origin or CSRF check for tests: it removes in the harness the protection that
    exists in production, so a misconfigured `trustedOrigins` -- a real and easy production defect --
    would become invisible exactly where it should be caught.
  - Setting `extraHTTPHeaders` globally in the Playwright config: it also applies to browser
    navigations, where Chrome already computes the header. Pinning a value there overrides the real
    client's behaviour in the one place the harness has a real client.
  - Keeping `expect(response.ok()).toBe(false)`: that is the assertion that hid the defect. A
    refusal test that cannot tell which layer refused is a test of nothing.
- **Acceptance evidence:** The canary republished on this commit is fully green, quality and E2E,
  where the previous publication failed the three specs that create an account. On the Production
  deployment, an invited address that walked `/invite/<token>` was admitted (HTTP 200, account
  created, invitation consumed), and the same invitation without the link was refused with HTTP 422
  `FAILED_TO_CREATE_USER`, leaving no account and an unspent invitation. Both test identities were
  removed afterwards.
- **When to revisit:** If Better Auth extends its transport requirements -- the `Sec-Fetch-*`
  handling in the same middleware is the obvious candidate -- the helper is where that is taught,
  and the refusal-code list is where the new failure mode is excluded.
