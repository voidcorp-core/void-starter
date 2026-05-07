import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppEnv } from './env';

describe('createAppEnv', () => {
  it('parses valid env successfully', () => {
    const env = createAppEnv({
      server: { LOG_LEVEL: z.enum(['debug', 'info']).default('info') },
      client: { NEXT_PUBLIC_APP_URL: z.string().url() },
      runtimeEnv: {
        LOG_LEVEL: 'debug',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
      },
    });
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://example.com');
  });

  it('throws on invalid env', () => {
    expect(() =>
      createAppEnv({
        server: { LOG_LEVEL: z.enum(['debug', 'info']) },
        client: {},
        runtimeEnv: { LOG_LEVEL: 'invalid' },
      }),
    ).toThrow();
  });
});
