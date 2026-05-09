import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, ValidationError } from './errors';
import { defineAction, defineFormAction, initialActionState } from './server-action';

describe('defineAction', () => {
  it('parses input via the Zod schema before calling handler', async () => {
    const handler = vi.fn(async (input: { name: string }) => ({ ok: true, name: input.name }));
    const action = defineAction({
      schema: z.object({ name: z.string().min(1) }),
      auth: 'public',
      handler,
    });

    const result = await action({ name: 'alice' });
    expect(handler).toHaveBeenCalledWith(
      { name: 'alice' },
      expect.objectContaining({ user: null }),
    );
    expect(result).toEqual({ ok: true, name: 'alice' });
  });

  it('rejects invalid input with a ValidationError', async () => {
    const handler = vi.fn();
    const action = defineAction({
      schema: z.object({ name: z.string().min(1) }),
      auth: 'public',
      handler,
    });

    await expect(action({ name: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes ctx with null user when auth=public', async () => {
    const handler = vi.fn(async (_input: unknown, ctx: { user: unknown }) => ctx.user);
    const action = defineAction({
      schema: z.object({}),
      auth: 'public',
      handler,
    });

    const result = await action({});
    expect(result).toBeNull();
  });
});

describe('defineFormAction', () => {
  it('returns ok:true with parsed data on success', async () => {
    const action = defineFormAction({
      schema: z.object({ email: z.string().email() }),
      auth: 'public',
      handler: async ({ email }) => ({ greeting: `Hi ${email}` }),
    });
    const fd = new FormData();
    fd.set('email', 'a@b.co');

    const result = await action(initialActionState, fd);

    expect(result).toEqual({ ok: true, data: { greeting: 'Hi a@b.co' } });
  });

  it('returns ok:false with fieldErrors when schema fails', async () => {
    const action = defineFormAction({
      schema: z.object({ email: z.string().email() }),
      auth: 'public',
      handler: async () => 'unused',
    });
    const fd = new FormData();
    fd.set('email', 'not-an-email');

    const result = await action(initialActionState, fd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors['email']).toBeDefined();
      expect(result.fieldErrors['email']?.[0]).toMatch(/email/i);
    }
  });

  it('maps AppError thrown by the handler to a structured formError', async () => {
    class TakenError extends AppError {
      constructor() {
        super({ message: 'Already taken', code: 'TAKEN', status: 409 });
        this.name = 'TakenError';
      }
    }
    const action = defineFormAction({
      schema: z.object({ email: z.string().email() }),
      auth: 'public',
      handler: async () => {
        throw new TakenError();
      },
    });
    const fd = new FormData();
    fd.set('email', 'a@b.co');

    const result = await action(initialActionState, fd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.formError).toEqual({ code: 'TAKEN', message: 'Already taken' });
      expect(result.fieldErrors).toEqual({});
    }
  });

  it('re-throws Next.js redirect errors so the framework can swallow them', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/dashboard;307;',
    });
    const action = defineFormAction({
      schema: z.object({ email: z.string().email() }),
      auth: 'public',
      handler: async () => {
        throw redirectErr;
      },
    });
    const fd = new FormData();
    fd.set('email', 'a@b.co');

    await expect(action(initialActionState, fd)).rejects.toBe(redirectErr);
  });
});
