import type { ZodType, infer as zInfer } from 'zod';
import { isAppError, ValidationError } from './errors';
import { logger } from './logger';

export type ActionAuth = 'public' | 'required' | `role:${string}`;

export type ActionContext = {
  user: { id: string; role: string } | null;
};

type DefineActionConfig<TSchema extends ZodType, TResult> = {
  schema: TSchema;
  auth: ActionAuth;
  handler: (input: zInfer<TSchema>, ctx: ActionContext) => Promise<TResult>;
};

// Phase A scaffolding: auth resolution stub. Phase B replaces this with a real
// import from @void/auth. Anything other than 'public' will throw at call time
// until then.
async function resolveAuth(auth: ActionAuth): Promise<ActionContext> {
  if (auth === 'public') return { user: null };
  throw new Error(`defineAction: auth mode "${auth}" requires @void/auth, available in Phase B`);
}

/**
 * Bare typed RPC Server Action factory.
 *
 * Auth resolution is a STUB: any non-`'public'` auth mode throws at handler
 * invocation time because this package has no dependency on `@void/auth` (by
 * design — it lets the core be unit-tested in isolation).
 *
 * For real apps, import `defineAction` from `@void/auth` instead. That
 * version wires the Better-Auth session into `ctx.user` and resolves
 * `'required'` / `'role:admin'` correctly. The bare version exported here
 * is only useful when testing the core without an auth dependency.
 */
export function defineAction<TSchema extends ZodType, TResult>({
  schema,
  auth,
  handler,
}: DefineActionConfig<TSchema, TResult>) {
  return async function action(rawInput: unknown): Promise<TResult> {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'action: validation failed');
      throw new ValidationError('Invalid input', parsed.error);
    }

    const ctx = await resolveAuth(auth);
    return handler(parsed.data, ctx);
  };
}

/**
 * `defineFormAction` — the form-driven sibling of `defineAction`.
 *
 * Bound to `<form action={...}>` and `useActionState(...)` semantics: the
 * action receives a `FormData`, returns a serializable `ActionState`, and
 * never throws for validation or domain errors. The two factories share the
 * same Zod schema, the same auth resolver, and the same `AppError` mapping
 * — only the surface (RPC throw vs progressive return) differs.
 *
 * Why two factories instead of one overloaded `defineAction`:
 * see ADR 21. Short version — explicit > overloaded; each function has one
 * shape and the call site reads as what it is.
 *
 * Error policy:
 *   - Schema failure       → `{ ok: false, fieldErrors }` (per-field strings).
 *   - `AppError` thrown    → `{ ok: false, fieldErrors: {}, formError }`.
 *   - Next.js redirect     → re-thrown so the framework can swallow it.
 *   - Anything else        → re-thrown so the route's `error.tsx` boundary
 *                            renders. Form mode is for *expected* failures;
 *                            unexpected ones must remain visible.
 *
 * STUB AUTH WARNING: same caveat as `defineAction`. The bare version exported
 * here resolves only `'public'`; any other auth mode throws at handler call
 * time. Import `defineFormAction` from `@void/auth` for real apps — that
 * version wires the Better-Auth session into `ctx.user`. The bare version
 * is exported only so the core can be tested without an auth dependency.
 */

export type ActionState<TData = unknown> =
  | { ok: true; data: TData }
  | {
      ok: false;
      fieldErrors: Record<string, string[]>;
      formError?: { code: string; message: string };
    };

export const initialActionState: ActionState = { ok: false, fieldErrors: {} };

type FormActionConfig<TSchema extends ZodType, TResult> = {
  schema: TSchema;
  auth: ActionAuth;
  handler: (input: zInfer<TSchema>, ctx: ActionContext) => Promise<TResult>;
};

/**
 * Duck-typed Next.js redirect detector.
 *
 * `next/navigation`'s `redirect()` works by throwing a special Error whose
 * `digest` starts with `'NEXT_REDIRECT'`. The actual constructor lives at an
 * internal path (`next/dist/client/components/redirect-error`) that has shifted
 * across Next.js minor versions; importing from it would couple this file to
 * an unstable internal. The digest convention itself has been stable since
 * Next 14, so we duck-type. `notFound()` follows the same pattern with the
 * `NEXT_HTTP_ERROR_FALLBACK;404` digest — also re-thrown.
 */
function isNextControlFlowError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const digest = (error as Error & { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK');
}

export function defineFormAction<TSchema extends ZodType, TResult>({
  schema,
  auth,
  handler,
}: FormActionConfig<TSchema, TResult>) {
  return async function formAction(
    _prevState: ActionState<TResult>,
    formData: FormData,
  ): Promise<ActionState<TResult>> {
    try {
      const raw = Object.fromEntries(formData);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
        logger.warn({ issues: parsed.error.issues }, 'formAction: validation failed');
        return { ok: false, fieldErrors };
      }

      const ctx = await resolveAuth(auth);
      const data = await handler(parsed.data, ctx);
      return { ok: true, data };
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;
      if (isAppError(error)) {
        return {
          ok: false,
          fieldErrors: {},
          formError: { code: error.code, message: error.message },
        };
      }
      throw error;
    }
  };
}
