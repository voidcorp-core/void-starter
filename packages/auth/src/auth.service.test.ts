import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock('next/server', () => ({
  connection: () => Promise.resolve(undefined),
}));

// `getCurrentUser()` short-circuits to `null` when `BETTER_AUTH_SECRET` is unset
// (see auth.service.ts -> `isAuthConfigured`). The unit tests below simulate a
// fully-configured auth environment, so we set the marker for the test process.
process.env['BETTER_AUTH_SECRET'] = 'test-secret-for-unit-tests-this-is-long-enough';

const mockGetSession = vi.fn();

vi.mock('./auth.repository', () => ({
  getAuth: () => ({
    api: {
      getSession: mockGetSession,
    },
  }),
}));

import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { getCurrentUser, requireAuth, requireRole } from './auth.service';

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns parsed user when session exists', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.co',
        name: 'Alice',
        image: null,
        role: 'user',
      },
    } as never);
    const user = await getCurrentUser();
    expect(user?.email).toBe('a@b.co');
  });

  it('returns null without calling getAuth when BETTER_AUTH_SECRET is unset', async () => {
    const original = process.env['BETTER_AUTH_SECRET'];
    delete process.env['BETTER_AUTH_SECRET'];
    mockGetSession.mockClear();
    try {
      const user = await getCurrentUser();
      expect(user).toBeNull();
      expect(mockGetSession).not.toHaveBeenCalled();
    } finally {
      process.env['BETTER_AUTH_SECRET'] = original;
    }
  });
});

describe('requireAuth', () => {
  it('throws UnauthorizedError when not signed in', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireRole', () => {
  it('throws ForbiddenError when user lacks role', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.co',
        name: null,
        image: null,
        role: 'user',
      },
    } as never);
    await expect(requireRole('admin')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('passes when user is admin', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.co',
        name: null,
        image: null,
        role: 'admin',
      },
    } as never);
    const user = await requireRole('admin');
    expect(user.role).toBe('admin');
  });
});
