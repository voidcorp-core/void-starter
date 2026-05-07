import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors';
import { defineAction } from './server-action';

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
