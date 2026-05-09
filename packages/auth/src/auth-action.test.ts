import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * `vi.mock(...)` is hoisted by vitest above all imports, but we keep it at
 * the top of the file (before the `getCurrentUser` import) for readers who
 * scan top-to-bottom. The mock returns a vi.fn() so each test can configure
 * its own resolved value via `mockResolvedValueOnce`, which scopes the
 * stub to a single call and avoids cross-test bleed.
 */
vi.mock('./auth.service', () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from './auth.service';
import { defineAction, defineFormAction, initialActionState } from './auth-action';

const getCurrentUserMock = vi.mocked(getCurrentUser);

describe('defineAction (auth-aware)', () => {
  it('passes when auth=required and user is signed in', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'user',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'required',
      handler: async (_input, ctx) => ctx.user,
    });

    const result = await action({});
    expect(result?.id).toBe('u1');
    expect(result?.role).toBe('user');
  });

  it('throws UnauthorizedError when auth=required and user is null', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const action = defineAction({
      schema: z.object({}),
      auth: 'required',
      handler: async () => 'ok',
    });

    await expect(action({})).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('passes when auth=role:admin and user is admin', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'admin',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'role:admin',
      handler: async (_input, ctx) => ctx.user?.role,
    });

    expect(await action({})).toBe('admin');
  });

  it('throws ForbiddenError when auth=role:admin and user is regular user', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'user',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'role:admin',
      handler: async () => 'ok',
    });

    await expect(action({})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('defineFormAction (auth-aware)', () => {
  it('passes when auth=required and user is signed in', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.co',
      name: null,
      image: null,
      role: 'user',
    });
    const action = defineFormAction({
      schema: z.object({ note: z.string().min(1) }),
      auth: 'required',
      handler: async (_input, ctx) => ({ userId: ctx.user?.id }),
    });
    const fd = new FormData();
    fd.set('note', 'hi');

    const result = await action(initialActionState, fd);

    expect(result).toEqual({ ok: true, data: { userId: 'u1' } });
  });

  it('returns ok:false with UNAUTHORIZED formError when auth=required and user is null', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const action = defineFormAction({
      schema: z.object({ note: z.string().min(1) }),
      auth: 'required',
      handler: async () => 'unused',
    });
    const fd = new FormData();
    fd.set('note', 'hi');

    const result = await action(initialActionState, fd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.formError?.code).toBe('UNAUTHORIZED');
      expect(result.fieldErrors).toEqual({});
    }
  });
});
