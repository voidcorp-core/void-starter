---
date: 2026-07-29
title: "Exercise a manifest access mode the starter does not ship"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-29: Exercise a manifest access mode the starter does not ship

- **Date:** 2026-07-29
- **Decision:** Any manifest option that changes the contract of an endpoint the test harness
  already uses must be exercised inside the starter's own CI, under a forced mode, not only in a
  generated project. `invite-only-http.integration.test.ts` mocks `./access-mode` to
  `invite_only` and drives Better Auth's own handler with a `Request`, against the CI Postgres.
  It asserts the effect on the rows -- account created and invitation consumed on admission, no
  account and an unspent invitation on either refusal -- rather than the status alone.
- **Why:** The starter ships `public_verified`, so before this suite nothing in its pipeline ever
  entered the invite-only hook. The unit suite hands `presentedToken` to the rule as a parameter,
  so it cannot observe a token lost between the cookie and the hook, and the Playwright specs
  register no invite-only scenario at all, by design (ADR 63 makes the mode generated code, not an
  environment variable). The contract therefore only ran inside a generated project. That single
  blind spot produced two consecutive defects: ADR 63 shipped a token that was never verified, and
  ADR 65 then shipped what looked like a broken admission. Each cost a canary round trip to see,
  and the second one was not even a production defect -- Playwright's `APIRequestContext` owns its
  cookie jar, so the hand-written `Cookie` header the fixtures passed never reached the server.
  A suite that runs the real handler in three minutes names that difference; a canary cannot.
- **Rejected alternatives:**
  - Generating an `invite_only` project inside the starter's CI: the honest end-to-end answer, but
    it makes the starter's pipeline depend on the factory and on a full generation per run, for a
    contract that lives in `packages/auth`. The generated project already has its own pipeline.
  - Parameterizing the Playwright matrix over the access mode: the specs read a generated constant,
    which is the point of ADR 63. Forcing it for the browser run would mean regenerating the app.
  - Trusting the live canary as the gate: it is the gate for provisioning and deployment, where
    nothing else can stand in for a real provider. For a rule that runs in-process, it converts a
    three-minute signal into an hour-long one, and it stayed silent here for as long as the fixture
    was the thing at fault.
- **Acceptance evidence:** The suite runs only where `DATABASE_URL` and `BETTER_AUTH_SECRET` exist,
  which is CI, and covers admission with the address's own token, refusal with no token, and refusal
  with a token issued for another address. The live canary republished on this same commit remains
  the final gate for the deployed profile.
- **When to revisit:** `public_signup_gated_activation` is declared and still inert; it gets the
  same treatment when it is materialized. If a third mode arrives, the forced-mode mock stops
  scaling and the suite should take the mode as a parameter instead.
