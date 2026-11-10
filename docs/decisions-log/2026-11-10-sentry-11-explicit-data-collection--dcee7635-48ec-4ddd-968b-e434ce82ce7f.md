---
schemaVersion: 1
id: "adr:dcee7635-48ec-4ddd-968b-e434ce82ce7f"
createdAt: "2026-11-10T18:29:17.724Z"
title: "Pin Sentry data collection explicitly on the move to @sentry/nextjs 11"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Pin Sentry data collection explicitly on the move to @sentry/nextjs 11

## Context

`@sentry/nextjs` 10 is no longer the current major, and ADR 73 added a range-crossing `glob` 14
override only because the Sentry 10 bundler plugins held the vulnerable `glob` 13. Sentry 11
removes `sendDefaultPii`, which the starter set to `true` in all three runtimes, and replaces it
with `dataCollection`. Left unset, `dataCollection` now collects every HTTP body, every bound
database parameter, queue payloads and stack-frame local variables. Better Auth sends passwords
in request bodies and stores verification tokens through Drizzle, and the SDK's key-name filter
(`auth`, `token`, `session`, `password`, `cookie`, ...) inspects keys of headers, cookies and
query parameters, not the values inside a body, a SQL parameter or a minified stack frame.

## Decision

Move to `@sentry/nextjs` ^11.12.0 and pass one shared `SENTRY_DATA_COLLECTION`
(`_modules/observability-sentry/src/data-collection.ts`) to the browser, Node and Edge inits,
turning off HTTP bodies, database query data, queue payloads, AI and MCP content and stack-frame
local variables.

## Consequences

Positive:

- Passwords, verification tokens and job payloads cannot reach Sentry through the channels the
  key filter does not cover, whatever runtime raises the event.
- The `glob` override is removed: Sentry 11 bundler plugins require `glob` ^14 themselves.
- The Factory generates `^11.12.0` and imports `withSentryConfig` from `@sentry/nextjs/config`.

Negative:

- Error events carry no request body, SQL parameters or local variables, so some bugs need a
  reproduction instead of a single event to diagnose.
- A token carried in a URL path segment (Better Auth `/reset-password/:token`) is not masked by
  the key filter; it is single-use and short-lived.

## Alternatives considered

- Leave `dataCollection` unset, the migration guide's mapping for `sendDefaultPii: true`:
  rejected because it silently widens collection to bodies and SQL parameters, where credentials
  live.
- Reproduce the v10 restrictive baseline (`userInfo` and `cookies` off as well): rejected because
  the starter deliberately ran with `sendDefaultPii: true` for user attribution, and the key filter
  already masks session cookies and auth headers.
- Stay on Sentry 10: rejected because it keeps a range-crossing `glob` override alive and defers
  a breaking migration that only grows.

## Reversal cost

Low. Widening a channel is a one-line change in `data-collection.ts`, and the SDK major can be
pinned back with a lockfile regeneration.
