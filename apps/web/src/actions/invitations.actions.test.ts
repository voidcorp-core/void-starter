import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const issueInvitationForAdmin = vi.fn();
const revokeInvitationFor = vi.fn();
const currentUser = { id: 'admin-1', role: 'admin' };

vi.mock('@repo/auth', () => ({
  issueInvitationForAdmin: (...args: unknown[]) => issueInvitationForAdmin(...args),
  revokeInvitationFor: (...args: unknown[]) => revokeInvitationFor(...args),
  // Minimal stand-in for the real wrapper. The positional `(input, ctx)`
  // handler signature mirrors `defineAction` in @repo/auth exactly: an
  // object-destructured stand-in would type-check here and fail the real build,
  // which is precisely the mistake this shape prevents. The wrapper's own
  // behaviour (session resolution, role check) is covered in @repo/auth.
  defineAction:
    ({
      schema,
      auth,
      handler,
    }: {
      schema: { parse: (value: unknown) => unknown };
      auth: string;
      handler: (input: never, ctx: { user: typeof currentUser }) => Promise<unknown>;
    }) =>
    async (rawInput: unknown) => {
      if (auth === 'role:admin' && currentUser.role !== 'admin') {
        throw new Error('FORBIDDEN');
      }
      return handler(schema.parse(rawInput) as never, { user: currentUser });
    },
}));

const { issueInvitationAction, revokeInvitationAction } = await import('./invitations.actions');

describe('issueInvitationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues for the requested address and attributes it to the calling administrator', async () => {
    issueInvitationForAdmin.mockResolvedValue({
      id: 'invitation-1',
      email: 'invitee@example.com',
      token: 'raw-token',
      expiresAt: new Date('2026-07-31T10:00:00.000Z'),
    });

    const result = await issueInvitationAction({ email: 'invitee@example.com' });

    expect(issueInvitationForAdmin).toHaveBeenCalledWith({
      email: 'invitee@example.com',
      invitedBy: 'admin-1',
    });
    // A path, not a bare token: the token is only usable through /invite,
    // which is what parks it in the cookie the admission check reads (ADR 65).
    // The origin is added client-side, where it is known without configuration.
    expect(result).toMatchObject({
      email: 'invitee@example.com',
      invitePath: '/invite/raw-token',
      expiresAt: '2026-07-31T10:00:00.000Z',
    });
  });

  it('returns no bare token alongside the link, so the credential appears once and in one shape', async () => {
    issueInvitationForAdmin.mockResolvedValue({
      id: 'invitation-1',
      email: 'invitee@example.com',
      token: 'raw-token',
      expiresAt: new Date('2026-07-31T10:00:00.000Z'),
    });

    const result = await issueInvitationAction({ email: 'invitee@example.com' });

    expect(result).not.toHaveProperty('token');
  });

  it('percent-encodes the token in the path so a link is never malformed', async () => {
    issueInvitationForAdmin.mockResolvedValue({
      id: 'invitation-1',
      email: 'invitee@example.com',
      token: 'raw token/with?specials',
      expiresAt: new Date('2026-07-31T10:00:00.000Z'),
    });

    const result = await issueInvitationAction({ email: 'invitee@example.com' });

    expect(result).toMatchObject({ invitePath: '/invite/raw%20token%2Fwith%3Fspecials' });
  });

  it('rejects an input that is not an email address before touching the ledger', async () => {
    await expect(issueInvitationAction({ email: 'not-an-email' })).rejects.toThrow();
    expect(issueInvitationForAdmin).not.toHaveBeenCalled();
  });

  it('propagates the refusal when the address already holds a pending invitation', async () => {
    issueInvitationForAdmin.mockRejectedValue(new Error('pending invitation'));

    await expect(issueInvitationAction({ email: 'invitee@example.com' })).rejects.toThrow(
      /pending invitation/i,
    );
  });
});

describe('revokeInvitationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the revocation when a pending invitation existed', async () => {
    revokeInvitationFor.mockResolvedValue(true);

    await expect(revokeInvitationAction({ email: 'invitee@example.com' })).resolves.toEqual({
      revoked: true,
    });
  });

  it('reports a no-op instead of failing when nothing was pending', async () => {
    revokeInvitationFor.mockResolvedValue(false);

    await expect(revokeInvitationAction({ email: 'invitee@example.com' })).resolves.toEqual({
      revoked: false,
    });
  });
});
