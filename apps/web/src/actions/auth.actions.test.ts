import { describe, expect, it, vi } from 'vitest';

// Mock @repo/auth's defineAction as a passthrough: schema/auth resolution is
// covered by the core (@repo/core/server-action) and auth-action unit tests.
// Here we only assert the handler's behavior (signOut + redirect). The real
// next/navigation redirect() is used so the thrown NEXT_REDIRECT digest is real.
vi.mock('@repo/auth', () => ({
  defineAction:
    ({ handler }: { handler: (input: unknown, ctx: unknown) => Promise<unknown> }) =>
    (input: unknown) =>
      handler(input, { user: { id: 'u1', role: 'user' } }),
  signOut: vi.fn(async () => {}),
}));

describe('signOutAction', () => {
  it('signs out once, then triggers a NEXT_REDIRECT to /', async () => {
    const { signOutAction } = await import('./auth.actions');
    const { signOut } = await import('@repo/auth');

    // redirect() throws an Error whose `digest` is
    // 'NEXT_REDIRECT;push;/;<status>;<timestamp>'.
    let captured: unknown;
    try {
      await signOutAction({});
    } catch (error) {
      captured = error;
    }

    expect(vi.mocked(signOut)).toHaveBeenCalledOnce();
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error & { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
  });
});
