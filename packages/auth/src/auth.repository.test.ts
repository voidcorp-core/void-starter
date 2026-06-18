import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a server bundle (including vitest); neutralize it
// so the pure resolveGoogleProvider export can be imported in isolation.
vi.mock('server-only', () => ({}));

import { resolveGoogleProvider } from './auth.repository';

describe('resolveGoogleProvider', () => {
  it('returns the google provider when both credentials are present', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toEqual({ google: { clientId: 'id', clientSecret: 'secret' } });
  });

  it('returns undefined when the client id is missing', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toBeUndefined();
  });

  it('returns undefined when the client secret is missing', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: undefined }),
    ).toBeUndefined();
  });

  it('returns undefined when both are missing (email/password + magic link only)', () => {
    expect(resolveGoogleProvider({})).toBeUndefined();
  });

  it('treats empty strings as not configured', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }),
    ).toBeUndefined();
  });
});
