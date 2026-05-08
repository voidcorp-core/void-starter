import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppEnv, required } from './env';

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

describe('required', () => {
  const VAR = '__VOID_REQUIRED_TEST_VAR__';
  let snapshot: string | undefined;

  beforeEach(() => {
    snapshot = process.env[VAR];
    delete process.env[VAR];
  });

  afterEach(() => {
    if (snapshot === undefined) {
      delete process.env[VAR];
    } else {
      process.env[VAR] = snapshot;
    }
  });

  it('returns the value when set', () => {
    process.env[VAR] = 'postgres://user:pw@host/db';
    expect(required(VAR)).toBe('postgres://user:pw@host/db');
  });

  it('throws a clear error when missing', () => {
    expect(() => required(VAR)).toThrow(`Missing required env var: ${VAR}`);
  });

  it('throws when set to empty string', () => {
    process.env[VAR] = '';
    expect(() => required(VAR)).toThrow(`Missing required env var: ${VAR}`);
  });
});
