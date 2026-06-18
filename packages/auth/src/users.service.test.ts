import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a server bundle (vitest); neutralize it.
vi.mock('server-only', () => ({}));

const mockListActiveUsers = vi.fn();
vi.mock('./users.repository', () => ({
  listActiveUsers: () => mockListActiveUsers(),
}));

import { listUsers } from './users.service';

describe('listUsers', () => {
  it('delegates to the repository (live read, no cache)', async () => {
    const rows = [
      { id: 'u1', email: 'a@b.co', name: 'Alice', role: 'user', createdAt: new Date() },
    ];
    mockListActiveUsers.mockResolvedValueOnce(rows);

    const result = await listUsers();

    expect(result).toBe(rows);
    expect(mockListActiveUsers).toHaveBeenCalledOnce();
  });
});
