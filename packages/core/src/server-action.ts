import type { ZodType, infer as zInfer } from 'zod';
import { ValidationError } from './errors';
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
