import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));

vi.mock('./auth.repository', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { auth } from './auth.repository';
import { getCurrentUser, requireAuth, requireRole } from './auth.service';

const getSessionMock = vi.mocked(auth.api.getSession);

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns parsed user when session exists', async () => {
    getSessionMock.mockResolvedValueOnce({
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
});

describe('requireAuth', () => {
  it('throws UnauthorizedError when not signed in', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireRole', () => {
  it('throws ForbiddenError when user lacks role', async () => {
    getSessionMock.mockResolvedValueOnce({
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
    getSessionMock.mockResolvedValueOnce({
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
