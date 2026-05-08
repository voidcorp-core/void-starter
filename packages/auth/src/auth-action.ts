import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import {
  type ActionAuth,
  type ActionContext,
  defineAction as defineActionCore,
} from '@void/core/server-action';
import type { ZodType } from 'zod';
import { getCurrentUser } from './auth.service';

/**
 * Auth-aware `defineAction` for `@void/auth`.
 *
 * Bridges `@void/core/server-action` (the auth-agnostic core) with
 * `@void/auth/auth.service` (the Better-Auth backed session reader).
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
  if (auth === 'public') return { user: null };

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

type DefineActionConfig<TSchema extends ZodType, TResult> = Parameters<
  typeof defineActionCore<TSchema, TResult>
>[0];

export function defineAction<TSchema extends ZodType, TResult>(
  config: DefineActionConfig<TSchema, TResult>,
) {
  // Pass `auth: 'public'` to the core so its built-in auth stub no-ops
  // (it throws for any non-public mode until @void/auth is wired in —
  // which is precisely here). We then resolve the real auth context in
  // our handler and ignore the core's `_ctx`. This is the substitution
  // pattern the core was designed for: it stays auth-agnostic, and this
  // wrapper provides the real implementation.
  return defineActionCore({
    schema: config.schema,
    auth: 'public',
    handler: async (input, _ctx) => {
      const ctx = await resolveAuth(config.auth);
      return config.handler(input, ctx);
    },
  });
}
