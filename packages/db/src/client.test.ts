import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * Static import on purpose. It pays the cold `drizzle-orm/postgres-js` graph at
 * file load, where every other test file pays its subject's import and where
 * Vitest runs no clock (cases default to 5 s, hooks to 10 s, collection is
 * unbounded). As the first dynamic import of the process, inside the first
 * case, that graph cost 1291 to 1349 ms under the root Turborepo fan-out and
 * up to 6376 ms at load average 25 to 42, past the case default; the cases
 * below now run in 4 to 8 ms. Vitest externalizes `node_modules` behind Node's
 * own import cache, so `vi.resetModules()` re-evaluates only the inlined
 * workspace sources (1 ms measured). A bounded `beforeAll` warm-up was rejected
 * because it only moves the contention flake from the case clock to the hook
 * clock. ADR 12 carries the dated measurements and the rejected alternatives.
 */
import * as client from './client';

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

  it('exports a function (no Proxy, no const db)', () => {
    expect(typeof client.getDb).toBe('function');
    expect('db' in client).toBe(false);
  });

  it('throws a clear error when DATABASE_URL is missing', async () => {
    // Fresh module so the lazy `cached` slot is unset for this case. The
    // top-level namespace cannot be re-evaluated, so a fresh instance is proven
    // by identity rather than assumed from `vi.resetModules()`.
    const mod = await import('./client');
    expect(mod).not.toBe(client);
    expect(() => mod.getDb()).toThrow();
  });
});
