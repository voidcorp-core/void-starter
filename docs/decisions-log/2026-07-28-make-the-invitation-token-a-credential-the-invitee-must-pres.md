---
date: 2026-07-28
title: "Make the invitation token a credential the invitee must present"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-28: Make the invitation token a credential the invitee must present

- **Date:** 2026-07-28
- **Decision:** Admission under `invite_only` now requires two things: a pending, unexpired,
  unrevoked invitation for the address, AND the token that invitation was issued with. The token
  travels in a short-lived, `httpOnly` cookie parked by a new `/invite/<token>` route, and the
  user-create hook reads it from the request headers. Comparison is constant-time over the digests.
  The admin screen hands out a complete link rather than a bare token, and the server action returns
  `invitePath` instead of `token`.
- **Why:** ADR 63 stored a SHA-256 digest of a `randomBytes(32)` token, described it as "the bearer
  credential in the mailed link", and never verified it: `hashInvitationToken` was called only on
  the write path. Admission was keyed on the email alone. The DEV-474 canary proved it on the real
  Production deployment by creating the invited account without ever holding the token. On an
  internal tool, where addresses follow a company pattern and are therefore guessable, anyone could
  create an invited colleague's account before they did. They could not sign in, since verification
  still applies, but the post-creation hook consumes the invitation, so the legitimate invitee found
  their address taken and their invitation spent -- a targeted, repeatable denial of onboarding.
  Every piece of the cryptographic apparatus was already in place; only the check was missing.
- **Rejected alternatives:**
  - A query parameter on `/sign-up`: the credential would then persist in browser history, in the
    `Referer` header sent to any third party the page loads, and in every intermediate proxy log.
  - Passing the token as a sign-up request field: it would cover email sign-up only. Account
    creation also happens through magic link and a social provider callback, and that callback
    returns from an external redirect carrying nothing of ours. A cookie is the one carrier all
    three share, which is why the check can stay in the single user-create hook.
  - Validating the token in the `/invite` route: answering "is this token real" before an account is
    attempted turns the link into an oracle for which invitations exist. The route stays deliberately
    unable to tell, and the single decision point remains the hook.
  - Dropping the token entirely and keeping email-only admission: defensible for a mono-tenant tool,
    but then the digest column, the random token and the once-only display are dead weight that
    reads like a security control. Either verify it or remove it; keeping both is theatre.
- **Acceptance evidence:** Service tests cover admission with the right token, refusal with no token,
  refusal with a wrong token, refusal with a valid token issued for another address, and that a
  mismatch is indistinguishable from an absent invitation. Route tests cover the cookie attributes,
  the shape rejection, and that a malformed and a well-formed token get identical answers. E2E adds
  the three-way no-token / wrong-token / own-token case against a real database, and the sign-up
  suite now enters through the invitation link.
- **When to revisit:** If invitations ever need to be delivered by the application itself rather
  than by the administrator, the link becomes an email template and the once-only display can go.
