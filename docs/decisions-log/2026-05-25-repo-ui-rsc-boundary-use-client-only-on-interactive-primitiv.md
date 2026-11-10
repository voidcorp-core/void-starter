---
date: 2026-05-25
title: "`@repo/ui` RSC boundary: `'use client'` only on interactive primitives"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: `@repo/ui` RSC boundary: `'use client'` only on interactive primitives

- **Date:** 2026-05-09
- **Decision:** Components in `@repo/ui` declare `'use client'` only when they own behavior that requires client-side React (DOM event handlers via props that React must serialize through the boundary, refs forwarded to interactive elements, or hooks). Layout primitives that only render markup based on props remain pure server components with no directive. Initial inventory:
  - `'use client'`: `Button`, `Input`, `Label`, `Avatar` (all accept event handlers and/or wrap a Radix primitive that uses hooks internally — see ADR 18).
  - Server (no directive): `Card` (+ `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`).
- **Why:** Next.js 16 with React 19 RSC means every directive choice has runtime cost. A blanket `'use client'` on every UI primitive forfeits server rendering for the entire subtree, ships unnecessary JavaScript, and defeats the point of using App Router. Conversely, omitting `'use client'` on a component that consumers want to attach `onClick` to surfaces a confusing `Functions cannot be passed directly to Client Components` error at the wrong layer (the `apps/web` page boundary) instead of at the primitive itself. The convention "interactive primitive = client, layout primitive = server" gives consumers a predictable mental model: if you can imagine a `useState` inside it, it's a client component; otherwise server.
- **Ref forwarding idiom:** Interactive primitives accept `ref` as a regular prop (typed as `Ref<HTMLElement>`) rather than wrapping the component in `forwardRef`. React 19 dropped the requirement: refs are now forwarded automatically when declared as a prop, and `forwardRef` is on the deprecation runway. This keeps the component a plain function (cleaner stack traces, no `displayName` boilerplate) while preserving full ref support for consumers who need it.
- **Rejected alternatives:**
  - Mark all `@repo/ui` components `'use client'`: simpler rule, but eliminates server-rendering benefits for the bulk of layout markup (cards, avatars, future `Stack`, `Container`, `Divider`, etc.). Doesn't scale.
  - Mark none and let consumers wrap interactive uses in their own client components: shifts boilerplate to every consumer call site and makes `<Button onClick={...}>` impossible to use directly in a server component, which is the primary ergonomic win of shared primitives.
  - Split into two packages (`@repo/ui-server` + `@repo/ui-client`): premature, doubles the import surface, and the boundary is already enforced per-file by the directive — no need to encode it in package layout.
  - Keeping `forwardRef` for ecosystem inertia — rejected because React 19 deprecated the requirement; the project's quality bar is 2026 idiomatic, not lowest-common-denominator.
- **Convention going forward:** When adding a new `@repo/ui` component, the first question is "does this component receive function props or hold state?" If yes, file starts with `'use client';`. If no, no directive. If the component composes children that may be interactive (e.g., a `Modal` that wraps arbitrary content), the wrapper itself decides based on whether IT needs interactivity, not based on what children might pass through.
- **When to revisit:** If a layout primitive (e.g., `Card`) ever grows interactive behavior (collapsible state, hover-controlled animations driven from JS), promote it to `'use client'` in the same commit that adds the behavior — never speculatively.
