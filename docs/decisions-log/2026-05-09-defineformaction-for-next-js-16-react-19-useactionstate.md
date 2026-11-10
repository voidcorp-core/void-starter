---
date: 2026-05-09
title: "defineFormAction for Next.js 16 + React 19 useActionState"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: defineFormAction for Next.js 16 + React 19 useActionState

- **Date:** 2026-05-09
- **Decision:** `@repo/core/server-action` ships TWO Server Action factories: `defineAction` (typed RPC, current behaviour) and `defineFormAction` (FormData parsing + structured `ActionState` return + `useActionState` compatibility). Both share the same Zod schema, the same auth resolver, and the same `AppError` mapping. `@repo/auth` re-exports `defineFormAction` with auth-aware resolution, identical to how it already wraps the RPC `defineAction`.
- **Why:** Next.js 16 invokes Server Actions in two distinct modes. RPC: `await action(values)` — used by react-hook-form's `handleSubmit`, returns the handler value, throws on failure. Form-driven: `<form action={action}>` — payload is a `FormData`, used by progressive-enhancement flows and React 19's `useActionState`, which expects a `(prevState, formData) => Promise<state>` signature and a serializable return shape. A single overloaded factory serving both modes either branches at the entry on input shape (less type-safe, harder to read) or forces consumers to pick a mode at call time anyway. Two named factories keep each call site explicit, types tight, and the function name self-documents intent.
- **Canonical shape:**

  ```ts
  type ActionState<TData = unknown> =
    | { ok: true; data: TData }
    | { ok: false; fieldErrors: Record<string, string[]>; formError?: { code: string; message: string } };
  ```

  Schema failure surfaces as `fieldErrors`. Domain `AppError` (incl. `UnauthorizedError`, `ForbiddenError`, custom subclasses) surfaces as `formError`. Next.js redirect / notFound errors (digest `NEXT_REDIRECT` / `NEXT_HTTP_ERROR_FALLBACK`) are re-thrown so the framework can swallow them. Anything else is re-thrown so the route's `error.tsx` boundary renders — form mode is for _expected_ failures only.
- **Rejected alternatives:**
  - Single overloaded `defineAction` that detects FormData vs object: matches next-safe-action's API but requires runtime branching at the entry point and a return type that switches between throw-on-error (RPC) and return-state (form). Less type-safe, harder to read at the call site.
  - Drop in `next-safe-action` 8.x and remove our wrappers entirely: ADR 5 explicitly chose to keep the wrapper for control over error serialization. Re-evaluating that decision is bigger than this lot. Shipping `defineFormAction` inside our wrapper is faster AND keeps the surface area we control.
  - Use React's `useActionState` directly without a wrapper: requires every consumer to write `Object.fromEntries(formData)` + `safeParse` + AppError mapping inline. Same code, copy-pasted N times.
  - Importing the redirect-error type from `next/dist/client/components/redirect-error`: that path is internal and has shifted between Next minor versions. The duck-typed `digest` check is stable since Next 14 and is what the Next docs recommend for any try/catch around `redirect()`.
- **When to revisit:** When `next-safe-action`'s API stabilizes a clear advantage AND we accept its dependency. Or when React's experimental form actions land non-experimentally with a richer API that subsumes both modes. Or when the wrapper grows past 200 lines (ADR 5's stated revisit trigger).
