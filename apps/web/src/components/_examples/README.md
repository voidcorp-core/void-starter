# Canonical Component Examples

Before writing a component in this app, read both examples below. They encode
the structural decisions that keep the codebase maintainable as it scales.

---

## SimpleButton -- 5-file presentational component

**Path:** `_examples/SimpleButton/`

Demonstrates the minimal layout for any UI component that does not own server
data or actions:

| File | Role |
|---|---|
| `SimpleButton.tsx` | Presentational component. No `'use client'` unless the component itself needs browser APIs. Importing a client-marked `@void/ui` primitive is fine from a Server Component. |
| `SimpleButton.helper.ts` | Pure functions only. `formatLabel` transforms the label string: capitalizes, truncates at 40 chars, and upper-cases for primary tone. |
| `SimpleButton.helper.test.ts` | Unit tests for the helper -- no React rendering, no jsdom requirements. Fast and isolated. |
| `SimpleButton.types.ts` | All prop and variant types live here. Imported with `import type` at every call site. |
| `index.ts` | Barrel: re-exports the component and types only. Never re-exports internal helpers. |

Key takeaways:
- Extract any non-trivial label, date, or formatting logic into a pure helper.
- Tests target the helper, not the rendered tree -- keeps tests stable when markup changes.
- Types in their own file means type-only consumers never pull in React or component code.

---

## UserProfileCard -- 6-file interactive component

**Path:** `_examples/UserProfileCard/`

Demonstrates the layout for a component that owns a Server Action and uses the
React 19 progressive-enhancement form pattern:

| File | Role |
|---|---|
| `UserProfileCard.tsx` | Server Component default export. Calls `getCurrentUser()` server-side and passes the result as a prop to the client component. Imports and re-exports `UserProfileCardClient` as a named export (implementation detail, not on the barrel). |
| `UserProfileCard.client.tsx` | `'use client'` boundary. Uses `useActionState` + `useOptimistic` to bind the Server Action to a `<form>` with instant optimistic feedback. |
| `UserProfileCard.actions.ts` | `'use server'`. `updateProfileAction` is built with `defineFormAction` from `@void/auth` and `auth: 'required'`, which enforces an authenticated session before the Drizzle UPDATE runs. |
| `UserProfileCard.helper.ts` | Three pure helpers: `formatJoinDate` (Intl formatting), `computeStatus` (soft-delete-aware role mapping), `validateNameInput` (pre-flight client UX check, separate from the Zod server schema). |
| `UserProfileCard.helper.test.ts` | Full happy + edge-case coverage for all three helpers. No mocks, no jsdom, no rendering. |
| `UserProfileCard.types.ts` | `UserProfileCardProps` typed against `SessionUser` from `@void/auth`. |
| `index.ts` | Barrel: default-exports the Server Component wrapper and the prop types. Does NOT expose the client component or the action. |

Key patterns illustrated:

- **Server-to-client handoff.** The server reads auth and data; the client
  renders the interactive form. No client-side fetch waterfall.
- **`defineFormAction` with `auth: 'required'`.** Auth is enforced at the
  action layer, not the page layer. The handler receives a typed `ctx.user`.
- **`useActionState` + `useOptimistic`.** React 19's built-in form submission
  state without React Hook Form. The `_prevState` signature matches Next.js's
  `<form action={...}>` contract.
- **Soft-delete-aware status.** `computeStatus` checks `deletedAt` before role,
  mirroring the convention established in the `users` schema (ADR 8).
- **Helper isolation.** `validateNameInput` is a client-side pre-flight guard.
  It does not replace the Zod schema in the Server Action -- both exist at
  different trust boundaries.

---

## Why these examples exist

A fresh contributor or AI assistant picking up a ticket in this app should be
able to answer three questions from memory after reading these examples:

1. Where does pure logic live? (`.helper.ts`, tested without rendering)
2. Where does auth live? (`.actions.ts` via `defineFormAction`, never inline)
3. What does the barrel export? (component + types only, no internals)

Deviating from this structure requires an ADR entry in `docs/DECISIONS.md`.
