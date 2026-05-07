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

export function createInMemoryRateLimit(config: RateLimitConfig): RateLimiter {
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
