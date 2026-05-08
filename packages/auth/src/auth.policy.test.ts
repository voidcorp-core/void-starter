import { describe, expect, it } from 'vitest';
import { canAccessAdminPanel } from './auth.policy';
import type { SessionUser } from './auth.types';

const mkUser = (role: SessionUser['role']): SessionUser => ({
  id: '00000000-0000-0000-0000-000000000000',
  email: 'x@example.com',
  name: null,
  image: null,
  role,
});

describe('canAccessAdminPanel', () => {
  it('returns true for admin', () => {
    expect(canAccessAdminPanel(mkUser('admin'))).toBe(true);
  });

  it('returns false for user', () => {
    expect(canAccessAdminPanel(mkUser('user'))).toBe(false);
  });

  it('returns false for null user', () => {
    expect(canAccessAdminPanel(null)).toBe(false);
  });
});
