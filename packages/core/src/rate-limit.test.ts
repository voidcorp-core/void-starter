import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRateLimit } from './rate-limit';

describe('createMemoryRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to N requests in the window', async () => {
    const limit = createMemoryRateLimit({ max: 3, windowMs: 1_000 });
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(true);
  });

  it('blocks the next request after the cap', async () => {
    const limit = createMemoryRateLimit({ max: 2, windowMs: 1_000 });
    await limit.check('user-1');
    await limit.check('user-1');
    const result = await limit.check('user-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates buckets by key', async () => {
    const limit = createMemoryRateLimit({ max: 1, windowMs: 1_000 });
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-2')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(false);
  });

  it('refills after the window elapses', async () => {
    const limit = createMemoryRateLimit({ max: 1, windowMs: 1_000 });
    await limit.check('user-1');
    expect((await limit.check('user-1')).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect((await limit.check('user-1')).allowed).toBe(true);
  });
});
