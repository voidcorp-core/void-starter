# Caching

This document is the read / write cache strategy for void-starter MVPs running on Next.js 16. The architectural rationale (why Cache Components plus `updateTag()` delivers soft CQRS instead of an explicit Command bus) lives in `docs/DECISIONS.md` entry 10. The TS quirk that landed Cache Components stable in Next 16.0.0 is documented at ADR 23. The day-to-day file-naming patterns live in `docs/PATTERNS.md`.

Every rule here reflects what already ships in the repo. If your code disagrees with this doc, the doc is the source of truth -- update the code, or open an ADR to change the rule.

---

## 1. Intent and rules

Cache Components is the Next 16 stable feature that gates which segments of a render are cacheable, tagged, and invalidatable. The starter wires it via `cacheComponents: true` in `apps/web/next.config.ts`. Three rules govern every cache decision:

- **Reads cache at the SERVICE layer.** A service function that fetches data is the canonical place to declare `'use cache'` and `cacheTag(...)`. Components consume the service through actions and inherit cache behavior transparently.
- **Writes invalidate at the ACTION layer.** After a mutation succeeds, the Server Action calls `updateTag(...)` so the next read repopulates with fresh data.
- **Repositories never cache.** They always hit the DB. Caching at the repository layer breaks transactions and write paths because every `db.update(...)` would race against stale cache reads.

If you find yourself wanting to cache something at the repository layer, the answer is to push the cache up to the service. If you find yourself wanting to invalidate from a service, the answer is to push the invalidation down to the action. The layering is load-bearing.

---

## 2. Cache Components in Next 16

Cache Components was promoted from experimental to stable in Next 16.0.0. It unifies what used to be three separate experimental flags (`ppr`, `useCache`, `dynamicIO`) into a single configuration option:

```ts
// apps/web/next.config.ts
const config: NextConfig = {
  cacheComponents: true,
  // ... other config
};
```

The runtime API surface is small:

- **`'use cache'`** -- a directive at the top of a function or file. Marks the scope as cacheable. Importable from anywhere; the runtime hooks fire only when the directive is present.
- **`cacheTag(tag: string)`** from `next/cache` -- attach a tag to the current cache entry. Multiple tags allowed. Tags are how invalidation finds the entry.
- **`cacheLife(profile)`** from `next/cache` -- set the TTL (built-in profiles like `'minutes'`, `'hours'`, `'days'`, or a `{ stale, revalidate, expire }` object).
- **`updateTag(tag: string)`** from `next/cache` -- invalidate every cache entry tagged with `tag`. Must be called inside a Server Action or route handler -- calling from a render returns a build-time signal only.

Static analyzer note (ADR 23): TypeScript 6 introduced a deprecation diagnostic that interacts with Next's `paths` config. The `apps/web/tsconfig.json` workaround is documented; it does not affect cache semantics.

---

## 3. Where caching lives

The layering is enforced by convention, not by the runtime. The runtime accepts `'use cache'` anywhere; we restrict it to the service layer to keep transactions and writes correct.

- **Reads.** Service functions decorated with `'use cache'` plus one or more `cacheTag(...)` calls. The service composes the repository call, applies any pure transformation (via `<name>.helper.ts` or `<name>.mapper.ts`), and returns the domain shape.
- **Writes.** Server Actions in `apps/<app>/src/actions/` (or colocated `<Component>.actions.ts`). After the repository write succeeds, the action calls `updateTag(...)` for every tag that may now be stale.
- **Repositories.** Pure I/O. Always hit the DB. Never cache. They are the layer the rest of the system trusts to reflect ground truth.
- **Components.** Render the data the action returns. Do not call `'use cache'` in a component file directly -- the cache decision belongs to the service that owns the data, not the component that displays it. A component-level cache becomes invisible to the action layer's invalidation logic.

---

## 4. Convention examples

Pseudocode aligned with the patterns in this repo. `@void/auth` does not yet use Cache Components (see section 7); the canonical example below applies the moment a domain service ships read paths.

### Service: read with cache

```ts
// packages/users/src/users.service.ts
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { getUserRepository } from './users.repository';

export async function getUserById(id: string) {
  'use cache';
  cacheTag(`user:${id}`);
  cacheLife('hours');
  return getUserRepository().findById(id);
}

export async function listActiveUsersForAdmin() {
  'use cache';
  cacheTag('user:list:all');
  cacheLife('minutes');
  return getUserRepository().listActive();
}
```

### Action: write with invalidation

```ts
// apps/web/src/actions/user.actions.ts
'use server';

import { defineFormAction } from '@void/auth';
import { updateUserById } from '@void/users';
import { updateTag } from 'next/cache';
import { z } from 'zod';

export const updateUserNameAction = defineFormAction({
  schema: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
  }),
  auth: 'required',
  async handler({ id, name }, { user }) {
    if (user.id !== id && user.role !== 'admin') {
      // policy violation -- handled at action layer for explicit feedback
      throw new ForbiddenError('Cannot edit another user');
    }
    await updateUserById(id, { name });
    updateTag(`user:${id}`);
    updateTag('user:list:all');
    return { ok: true };
  },
});
```

### Component: just renders the data

```tsx
// apps/web/src/app/users/[id]/page.tsx
import { getUserById } from '@void/users';

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUserById(id); // hits cache, tagged user:${id}
  if (!user) return <p>Not found</p>;
  return <h1>{user.name}</h1>;
}
```

The cache lives at the service. The invalidation lives at the action. The component is unaware of either.

---

## 5. Tag naming convention

Tags are strings. The starter standardizes on three shapes:

- **`entity:id`** -- a single record. Example: `user:abc123`, `post:9f1e`. Invalidate when that one record changes.
- **`entity:list:scope`** -- a collection. Example: `user:list:all`, `post:list:user:abc123`, `post:list:tag:typescript`. The `scope` segment carries either a parent id, a filter key, a query hash, or `'all'`. Invalidate when the collection's membership or order may have changed.
- **`entity:relation:id`** -- a derived view. Example: `user:dashboard:abc123` for a per-user dashboard aggregate. Invalidate when any source feeding the aggregate changes.

Three rules for tagging:

- **Avoid global tags.** A bare `users` tag invalidates every user-scoped entry, defeating the point of caching.
- **Prefer narrow tags.** `user:list:user:${userId}` beats `user:list:all` if you can scope the read to one user. Narrow tags lose less work to invalidation churn.
- **Tag at every read path.** A read with no `cacheTag` is opaque to writes. The `updateTag` call has nothing to bind against.

---

## 6. Pitfalls

Things that look correct but fail in subtle ways.

- **Do NOT cache mutations.** A `'use cache'` directive on a function that performs a write (insert, update, delete) makes the write disappear after the first hit. Caches are for reads only.
- **Do NOT cache user-specific data without a user-scoped tag.** Caching the dashboard with tag `dashboard:all` serves user A's data to user B. Use `dashboard:user:${userId}` and invalidate only that scope when that user's data changes.
- **Do NOT call `updateTag()` outside an action.** Inside a render or a `'use cache'` function, `updateTag` is a build-time signal -- it does not invalidate the cache at runtime. Invalidation only fires from Server Actions and route handlers.
- **Do NOT wrap a repository function in `'use cache'`.** The cache layer would intercept writes too, breaking transactions and consistency. Cache the service, not the repository.
- **Do NOT mix `'use cache'` and `'use server'` in the same file.** They are different directives with different scopes. Service files (no directive at the file level) declare `'use cache'` per-function; action files declare `'use server'` at the file level and call `updateTag` per-handler.
- **Do NOT rely on `updateTag` to invalidate cross-process state.** It works on the deploy's cache, not on third-party caches (Cloudflare, an edge CDN in front of Vercel). If you put a CDN in front, plumb the invalidation to that cache too via its API.

---

## 7. Cross-references and current state

- **ADR 10** -- no DI, no explicit CQRS. Cache Components plus `updateTag()` delivers soft CQRS for free: read paths cache aggressively, write paths invalidate. Explicit Command and Query buses would prepay a cost the venture-builder cadence does not justify.
- **ADR 23** -- TypeScript 6 plus Next 16's `paths` config quirk. The `ignoreDeprecations: '6.0'` workaround in `apps/web/tsconfig.json` does not affect cache semantics; it only suppresses the TS6504 diagnostic.
- **`@void/auth` and Cache Components.** The auth package is currently a thin wrapper around Better-Auth and does NOT use Cache Components. Better-Auth's session reads are themselves optimized (cookie token plus a single DB lookup keyed on the session id); adding `'use cache'` on top would tag the wrong layer (the session read should not be tagged the same way a user record is). Future domain services in the starter (posts, projects, billing) will use Cache Components from day 1.
- **`docs/PATTERNS.md`** -- file naming conventions for service, repository, action.
- **`docs/ARCHITECTURE.md`** -- topology, layering rules, where each cache point lives.
- **`docs/SECURITY.md`** -- the user-scoped tag rule prevents the cross-tenant leak class of bug.

When a service ships its first read path with `'use cache'`, this doc should grow a "Real-world example" section pointing at the file. Until then, the pseudocode in section 4 is the canonical reference.
