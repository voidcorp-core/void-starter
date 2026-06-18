import 'server-only';

import { ForbiddenError, UnauthorizedError } from '@repo/core/errors';
import {
  type ActionAuth,
  type ActionContext,
  type ActionContextFor,
  type ActionState,
  defineAction as defineActionCore,
  defineFormAction as defineFormActionCore,
  initialActionState,
} from '@repo/core/server-action';
import type { ZodType, infer as zInfer } from 'zod';
import { getCurrentUser } from './auth.service';

export { type ActionState, initialActionState };

/**
 * Auth-aware `defineAction` for `@repo/auth`.
 *
 * Bridges `@repo/core/server-action` (the auth-agnostic core) with
 * `@repo/auth/auth.service` (the Better-Auth backed session reader).
 * The core stays free of any auth import, which keeps it testable in
 * isolation; this wrapper is the single point of contact between the
 * two layers.
 *
 * Behaviour:
 *   - `auth: 'public'`   → ctx.user = null, no session lookup.
 *   - `auth: 'required'` → resolves the current user; throws
 *                          `UnauthorizedError` (401) when unauthenticated.
 *   - `auth: 'role:X'`   → as `'required'`, plus `user.role === 'X'` (or
 *                          `user.role === 'admin'`, since admin always
 *                          satisfies any required role — same semantics as
 *                          `requireRole` in auth.service). Otherwise throws
 *                          `ForbiddenError` (403).
 *
 * The wrapper short-circuits the core's auth stub by injecting its own
 * `ctx` before the core handler runs. The public surface (`schema`, `auth`,
 * `handler`) is identical to the core, so callers can swap the import
 * without changing call sites — the only behavioural difference is auth
 * resolution, which is precisely the point of this layer.
 */

async function resolveAuth(auth: ActionAuth): Promise<ActionContext> {
  if (auth === 'public') return { user: null }; // allow-null: 'public' resolves to no authenticated user (established ActionContext shape).

  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Authentication required');

  if (auth === 'required') return { user: { id: user.id, role: user.role } };

  if (auth.startsWith('role:')) {
    const requiredRole = auth.slice('role:'.length);
    if (user.role !== requiredRole && user.role !== 'admin') {
      throw new ForbiddenError(`Role "${requiredRole}" required`);
    }
    return { user: { id: user.id, role: user.role } };
  }

  throw new Error(`defineAction: unknown auth mode "${auth}"`);
}

type DefineActionConfig<TSchema extends ZodType, TResult, A extends ActionAuth> = {
  schema: TSchema;
  auth: A;
  // ctx narrows on the auth mode: `'required'` / `'role:*'` give a non-null
  // `ctx.user`, so handlers read `ctx.user.id` without a guard.
  handler: (input: zInfer<TSchema>, ctx: ActionContextFor<A>) => Promise<TResult>;
};

export function defineAction<TSchema extends ZodType, TResult, A extends ActionAuth>(
  config: DefineActionConfig<TSchema, TResult, A>,
) {
  // Pass `auth: 'public'` to the core so its built-in auth stub no-ops
  // (it throws for any non-public mode until @repo/auth is wired in —
  // which is precisely here). We then resolve the real auth context in
  // our handler and ignore the core's `_ctx`. This is the substitution
  // pattern the core was designed for: it stays auth-agnostic, and this
  // wrapper provides the real implementation.
  return defineActionCore({
    schema: config.schema,
    auth: 'public',
    handler: async (input, _ctx) => {
      // resolveAuth returns a non-null user for every non-public mode (it throws
      // otherwise), so narrowing the resolved ActionContext to ActionContextFor<A>
      // is sound -- it mirrors the runtime guarantee.
      const ctx = await resolveAuth(config.auth);
      return config.handler(input, ctx as ActionContextFor<A>);
    },
  });
}

type DefineFormActionConfig<TSchema extends ZodType, TResult, A extends ActionAuth> = {
  schema: TSchema;
  auth: A;
  handler: (input: zInfer<TSchema>, ctx: ActionContextFor<A>) => Promise<TResult>;
};

/**
 * Auth-aware `defineFormAction` for `@repo/auth`.
 *
 * Same substitution pattern as the RPC `defineAction` above: the core stays
 * auth-agnostic; this wrapper resolves the real session via `getCurrentUser`
 * and short-circuits the core's `'public'` stub. Everything downstream
 * (FormData parsing, schema validation, error mapping, NEXT_REDIRECT
 * handling) lives in the core — this layer only owns auth.
 *
 * Auth failure surface in form mode: `UnauthorizedError` / `ForbiddenError`
 * thrown by `resolveAuth` are caught by the core wrapper and mapped to
 * `{ ok: false, formError: { code, message } }`. Consumers render the
 * formError without a try/catch, in line with React 19's `useActionState`
 * idiom.
 */
export function defineFormAction<TSchema extends ZodType, TResult, A extends ActionAuth>(
  config: DefineFormActionConfig<TSchema, TResult, A>,
) {
  return defineFormActionCore({
    schema: config.schema,
    auth: 'public',
    handler: async (input, _ctx) => {
      // Same sound narrowing as defineAction above.
      const ctx = await resolveAuth(config.auth);
      return config.handler(input, ctx as ActionContextFor<A>);
    },
  });
}
