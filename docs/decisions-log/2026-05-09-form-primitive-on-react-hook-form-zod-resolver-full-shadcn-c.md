---
date: 2026-05-09
title: "Form primitive on react-hook-form + zod resolver, full shadcn composition"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Form primitive on react-hook-form + zod resolver, full shadcn composition

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` ships a 7-component Form composition (Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage + `useFormField` hook) wrapping `react-hook-form` (RHF) and Zod via `@hookform/resolvers`. Consumers compose slot-by-slot.
- **Why:** RHF + Zod is the de-facto 2026 React form stack: type-safe end-to-end (schema → form values → field errors), tree-shakeable, no Provider boilerplate, integrates cleanly with React 19 `useActionState` + Server Actions for progressive enhancement. The 7-slot composition is shadcn/ui v3's pattern: it auto-wires `htmlFor` / `id` / `aria-describedby` / `aria-invalid` so a11y is correct without per-form boilerplate. A leaner API (e.g., a single `<Field name="x" />`) hides the slot architecture and rots within 2 MVPs once a form needs description text or asymmetric layouts.
- **Rejected alternatives:**
  - Native HTML5 forms + custom hook: works for trivial cases, fails on async validation + cross-field rules + focus management.
  - Formik: less type-safe inference, larger bundle, lower velocity since maintenance has slowed.
  - TanStack Form: excellent type ergonomics, but adoption is still trailing RHF and the integration with shadcn-style composition is less established. Revisit when next-forge / shadcn v4 commit to it.
  - Server-only validation via `defineAction` schema: necessary but insufficient. Without client-side validation, every typo in an email costs a network roundtrip and breaks the optimistic UI story.
- **When to revisit:** When TanStack Form ships a stable shadcn-style integration and outperforms RHF in real benchmarks, OR when React's experimental `<form action={...}>` + `useFormState` ergonomics make RHF redundant for simple forms.
