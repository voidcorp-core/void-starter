import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@repo/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from './route';

/** Generated the way real tokens are, rather than hardcoded: same shape, and no
 *  literal in the tree for a secret scanner to flag. */
const VALID_TOKEN = randomBytes(32).toString('base64url');

function invite(token: string, origin = 'https://app.example.com') {
  return {
    request: new NextRequest(`${origin}/invite/${token}`),
    params: Promise.resolve({ token }),
  };
}

/**
 * The invitation link entry point (ADR 65). Its whole job is to move the token
 * out of the URL and into a cookie the user-create hook can read, without ever
 * revealing whether that token is real.
 */
describe('GET /invite/[token]', () => {
  it('parks a well-formed token in a cookie and sends the invitee to sign-up', async () => {
    const { request, params } = invite(VALID_TOKEN);

    const response = await GET(request, { params });
    const cookie = response.cookies.get('void_invitation');

    expect(response.headers.get('location')).toBe('https://app.example.com/sign-up');
    expect(cookie?.value).toBe(VALID_TOKEN);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('marks the cookie secure when the request is served over https', async () => {
    const { request, params } = invite(VALID_TOKEN);

    const response = await GET(request, { params });

    expect(response.cookies.get('void_invitation')?.secure).toBe(true);
  });

  it('keeps the cookie usable on a plain-http origin, so a local production build still works', async () => {
    const { request, params } = invite(VALID_TOKEN, 'http://localhost:3000');

    const response = await GET(request, { params });

    expect(response.cookies.get('void_invitation')?.secure).toBe(false);
  });

  it('sets no cookie for a malformed token', async () => {
    const { request, params } = invite('not a token!!');

    const response = await GET(request, { params });

    expect(response.cookies.get('void_invitation')).toBeUndefined();
    expect(response.headers.get('location')).toBe('https://app.example.com/sign-up');
  });

  it('answers a malformed and a well-formed token the same way, revealing nothing', async () => {
    const malformed = await GET(...toArgs(invite('short')));
    const wellFormed = await GET(...toArgs(invite(VALID_TOKEN)));

    // A different status or destination would tell a visitor whether their
    // token was even plausible, which is the oracle this route must not be.
    expect(malformed.status).toBe(wellFormed.status);
    expect(malformed.headers.get('location')).toBe(wellFormed.headers.get('location'));
  });
});

function toArgs(input: ReturnType<typeof invite>) {
  return [input.request, { params: input.params }] as const;
}
