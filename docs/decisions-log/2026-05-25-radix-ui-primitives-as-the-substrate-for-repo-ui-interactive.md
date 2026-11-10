---
date: 2026-05-25
title: "Radix UI primitives as the substrate for `@repo/ui` interactive components"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: Radix UI primitives as the substrate for `@repo/ui` interactive components

- **Date:** 2026-05-09
- **Decision:** Interactive primitives in `@repo/ui` are built on `@radix-ui/react-*` packages rather than from-scratch DOM. Initial substrate: `@radix-ui/react-avatar` (Avatar), `@radix-ui/react-slot` (Button `asChild`), `@radix-ui/react-label` (Label). Future interactive primitives (Dialog, Popover, DropdownMenu, Toast, Tooltip, Select, Switch, Checkbox, RadioGroup, etc.) follow the same rule: pull the matching `@radix-ui/react-*` and wrap it with our CVA + Tailwind theming layer. Variant typing remains ours via CVA; behavior, accessibility, and DOM correctness come from Radix.
- **Why:** Radix is the de-facto 2026 substrate for accessible, unstyled React primitives (used by shadcn/ui, every major Vercel sample, and most production design systems). Building from scratch means re-implementing focus traps, escape handling, ARIA wiring, keyboard nav, RTL support, controlled/uncontrolled state, and SSR safety — work that takes weeks per primitive and is incident-prone (subtle regressions on every React/browser update). The cost we avoid is far greater than the ~2-5KB per primitive Radix adds; bundle weight is dominated by app code, not by primitives. The replacement of the raw `<img>` Avatar (no loading state, broken-image flash) with Radix Avatar (tri-state machine: idle → loading → loaded/error, fallback on both error AND not-yet-loaded) is the canonical example of why we don't roll our own. Radix also keeps the `@repo/ui` surface aligned with shadcn/ui v3 vocabulary, which lowers AI-assistant friction (every modern LLM has shadcn snippets in training data).
- **Rejected alternatives:**
  - **Headless UI (`@headlessui/react`):** good quality but narrower catalogue (no Avatar, no Toast, no Slot), tighter coupling to Tailwind, and slower release cadence. Loses the shadcn/ui ecosystem alignment.
  - **Ariakit:** technically excellent and arguably more rigorous than Radix, but smaller mindshare in 2026, fewer LLM-trained snippets, and the project has explicitly identified itself as the lower-traffic alternative. No upside that justifies leaving the ecosystem standard.
  - **Build everything from scratch:** rejected outright. Folpe's quality bar ("ultra moderne, exceptionnel") is incompatible with hand-rolled a11y; the venture builder cadence (~24 MVPs/year) makes the per-primitive amortization horrible (we'd reinvent Dialog ~24 times); and the failure mode (a primitive that ships an a11y bug into 24 MVPs at once) is a brand-integrity disaster. The earlier from-scratch Avatar already shipped the broken-image-flash regression — proof that even our trivial primitives benefit from delegation.
  - **Adopt shadcn/ui directly via the CLI (copy components into the repo):** considered. Rejected because shadcn's distribution model assumes a single Next.js app with components living in `app/components/ui/`; in a monorepo with `@repo/ui` as a shared workspace package, copying snippets per-app fragments the source of truth and prevents cross-app upgrades. We use shadcn as a _reference_ (vocabulary, copy-pastable structure) but vendor our own thin wrappers in `@repo/ui` so the workspace contract holds.
- **Conventions going forward:**
  - One Radix primitive per `@repo/ui` component file. No re-exporting `RadixDialog.Trigger` etc. directly — always wrap so the public surface is `<Dialog>`, `<DialogTrigger>`, etc., styled with our tokens and CVA variants.
  - `'use client'` on every Radix-backed primitive (they all use hooks/context) — consistent with ADR 16 ("interactive primitive = client").
  - Renovate handles minor/patch upgrades automatically. Major bumps go through `docs/DECISIONS.md` only if a public API breaks for our wrappers.
- **When to revisit:** If the React ecosystem shifts to a successor primitive library with broader adoption than Radix (signals: shadcn/ui swaps substrate, Vercel templates swap, the React team blesses an alternative), evaluate migration. If Radix abandons React 19+ support for an extended window without a clear successor, evaluate Ariakit at that point.
