export type RateLimitConfig = {
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type RateLimiter = {
  check: (key: string) => Promise<RateLimitResult>;
};

type Bucket = { count: number; resetAt: number };

/**
 * In-memory rate limiter. INTENT: tests + single-process dev only.
 *
 * On Vercel serverless or any horizontally-scaled deploy, the `Map` state
 * is per-invocation/per-process and effectively grants every request its
 * own counter — i.e. NO real rate limiting. Worse, this looks like it
 * works locally and fails silently in production. Use only when you
 * control the process model OR in unit tests.
 *
 * For production deployments use the `@void/rate-limit-upstash` module
 * (Phase D Task D12), which backs the limiter with Upstash Redis and
 * preserves the same `RateLimiter` interface for drop-in substitution.
 */
export function createMemoryRateLimit(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    check: async (key) => {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true, remaining: config.max - 1, retryAfterMs: 0 };
      }

      if (bucket.count >= config.max) {
        return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
      }

      bucket.count += 1;
      return {
        allowed: true,
        remaining: config.max - bucket.count,
        retryAfterMs: 0,
      };
    },
  };
}
