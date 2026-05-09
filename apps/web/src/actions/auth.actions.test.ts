import { describe, expect, it, vi } from 'vitest';

vi.mock('@void/auth', () => ({
  signOut: vi.fn(async () => {}),
}));

describe('signOutAction', () => {
  it('calls signOut once then triggers a NEXT_REDIRECT to /', async () => {
    const { signOutAction } = await import('./auth.actions');
    const { signOut } = await import('@void/auth');

    await expect(signOutAction()).rejects.toThrow();

    // Re-invoke once more, capture the thrown error, assert digest format.
    // Next's redirect() throws an Error whose `digest` is 'NEXT_REDIRECT;push;/;<statusCode>;<timestamp>'.
    let captured: unknown;
    try {
      await signOutAction();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(Error);
    const digest = (captured as Error & { digest?: string }).digest;
    expect(digest).toMatch(/^NEXT_REDIRECT/);

    // signOut called twice across both invocations.
    expect(vi.mocked(signOut)).toHaveBeenCalledTimes(2);
  });
});

// TODO(C24): once UserProfileCard.actions.ts ships updateProfileAction, add a
// describe block here covering the defineFormAction success / schema-failure
// paths with a mocked @void/auth (defineFormAction + getCurrentUser).
