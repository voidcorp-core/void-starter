import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a server bundle (vitest); neutralize it.
vi.mock('server-only', () => ({}));

// The 'use cache' directive is inert under vitest (no Next compiler), so the
// service body runs as a plain function. We mock next/cache to assert the
// service tags reads correctly, and mock the repository to keep the service
// test free of any DB.
const mockCacheTag = vi.fn();
const mockCacheLife = vi.fn();
vi.mock('next/cache', () => ({
  cacheTag: (tag: string) => mockCacheTag(tag),
  cacheLife: (profile: string) => mockCacheLife(profile),
}));

const mockListNotesByUser = vi.fn();
const mockCreateNote = vi.fn();
vi.mock('./notes.repository', () => ({
  listNotesByUser: (userId: string) => mockListNotesByUser(userId),
  createNote: (input: unknown) => mockCreateNote(input),
}));

import { createNote, listNotes } from './notes.service';

const row = {
  id: 'n1',
  userId: 'u1',
  title: 'Hello',
  body: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('listNotes', () => {
  it('returns the repository rows and tags the cache per user', async () => {
    mockListNotesByUser.mockResolvedValueOnce([row]);

    const result = await listNotes('u1');

    expect(result).toEqual([row]);
    expect(mockListNotesByUser).toHaveBeenCalledWith('u1');
    // User-scoped tag is the cross-tenant safety boundary (CACHING.md section 6).
    expect(mockCacheTag).toHaveBeenCalledWith('notes:list:user:u1');
    expect(mockCacheLife).toHaveBeenCalledWith('minutes');
  });
});

describe('createNote', () => {
  it('delegates to the repository without touching the cache', async () => {
    mockCreateNote.mockResolvedValueOnce(row);
    mockCacheTag.mockClear();

    const result = await createNote({ userId: 'u1', title: 'Hello', body: '' });

    expect(result).toBe(row);
    expect(mockCreateNote).toHaveBeenCalledWith({ userId: 'u1', title: 'Hello', body: '' });
    expect(mockCacheTag).not.toHaveBeenCalled();
  });
});
