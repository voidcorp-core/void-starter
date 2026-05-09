import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('getDb', () => {
  let snapshot: string | undefined;

  beforeEach(() => {
    snapshot = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    delete globalThis.__voidQueryClient;
    delete globalThis.__voidDb;
    vi.resetModules();
  });

  afterEach(() => {
    if (snapshot === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = snapshot;
    }
    delete globalThis.__voidQueryClient;
    delete globalThis.__voidDb;
  });

  it('exports a function (no Proxy, no const db)', async () => {
    const mod = await import('./client');
    expect(typeof mod.getDb).toBe('function');
    expect('db' in mod).toBe(false);
  });

  it('throws a clear error when DATABASE_URL is missing', async () => {
    // Fresh module so the lazy `cached` slot is unset for this case.
    const mod = await import('./client');
    expect(() => mod.getDb()).toThrow();
  });
});
