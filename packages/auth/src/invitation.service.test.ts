import { ForbiddenError } from '@repo/core/errors';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { InvitationTimestamps } from './invitation.helper';
import {
  assertSignUpAdmitted,
  consumeInvitationFor,
  type InvitationGateway,
  issueInvitation,
} from './invitation.service';

const now = new Date('2026-07-28T10:00:00.000Z');
const bootstrapAdminEmail = 'admin@example.com';

function gatewayReturning(invitation: InvitationTimestamps | undefined): InvitationGateway {
  return {
    findLatestInvitationByEmail: vi.fn(async () => invitation),
    markInvitationUsed: vi.fn(async () => true),
    insertInvitation: vi.fn(async () => undefined),
  };
}

const pending: InvitationTimestamps = {
  expiresAt: new Date('2026-07-29T10:00:00.000Z'),
  usedAt: null,
  revokedAt: null,
};

describe('assertSignUpAdmitted', () => {
  it('admits the bootstrap administrator without an invitation, so the tool can be opened at all', async () => {
    const gateway = gatewayReturning(undefined);

    await expect(
      assertSignUpAdmitted({ email: bootstrapAdminEmail, bootstrapAdminEmail, now, gateway }),
    ).resolves.toBeUndefined();

    expect(gateway.findLatestInvitationByEmail).not.toHaveBeenCalled();
  });

  it('matches the bootstrap administrator regardless of case and surrounding space', async () => {
    const gateway = gatewayReturning(undefined);

    await expect(
      assertSignUpAdmitted({
        email: '  ADMIN@Example.com ',
        bootstrapAdminEmail,
        now,
        gateway,
      }),
    ).resolves.toBeUndefined();
  });

  it('admits an address holding a pending, unexpired invitation', async () => {
    const gateway = gatewayReturning(pending);

    await expect(
      assertSignUpAdmitted({ email: 'invitee@example.com', bootstrapAdminEmail, now, gateway }),
    ).resolves.toBeUndefined();

    expect(gateway.findLatestInvitationByEmail).toHaveBeenCalledWith('invitee@example.com');
  });

  it('normalizes the address before the lookup, so a case variant cannot miss a revocation', async () => {
    const gateway = gatewayReturning(pending);

    await assertSignUpAdmitted({
      email: ' Invitee@Example.COM ',
      bootstrapAdminEmail,
      now,
      gateway,
    });

    expect(gateway.findLatestInvitationByEmail).toHaveBeenCalledWith('invitee@example.com');
  });

  it('refuses an address with no invitation at all', async () => {
    await expect(
      assertSignUpAdmitted({
        email: 'stranger@example.com',
        bootstrapAdminEmail,
        now,
        gateway: gatewayReturning(undefined),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a consumed invitation, so an invitation link cannot be replayed', async () => {
    await expect(
      assertSignUpAdmitted({
        email: 'invitee@example.com',
        bootstrapAdminEmail,
        now,
        gateway: gatewayReturning({ ...pending, usedAt: new Date('2026-07-27T10:00:00.000Z') }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a revoked invitation', async () => {
    await expect(
      assertSignUpAdmitted({
        email: 'invitee@example.com',
        bootstrapAdminEmail,
        now,
        gateway: gatewayReturning({ ...pending, revokedAt: new Date('2026-07-27T10:00:00.000Z') }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses an expired invitation', async () => {
    await expect(
      assertSignUpAdmitted({
        email: 'invitee@example.com',
        bootstrapAdminEmail,
        now,
        gateway: gatewayReturning({ ...pending, expiresAt: new Date('2026-07-27T10:00:00.000Z') }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gives every refusal the same message, so the endpoint does not confirm who was invited', async () => {
    const refusals = await Promise.all(
      [
        undefined,
        { ...pending, usedAt: new Date('2026-07-27T10:00:00.000Z') },
        { ...pending, revokedAt: new Date('2026-07-27T10:00:00.000Z') },
        { ...pending, expiresAt: new Date('2026-07-27T10:00:00.000Z') },
      ].map(async (invitation) =>
        assertSignUpAdmitted({
          email: 'invitee@example.com',
          bootstrapAdminEmail,
          now,
          gateway: gatewayReturning(invitation),
        }).catch((error: unknown) => (error as Error).message),
      ),
    );

    expect(new Set(refusals).size).toBe(1);
  });

  it('refuses everyone when no bootstrap administrator is configured and no invitation exists', async () => {
    await expect(
      assertSignUpAdmitted({
        email: 'stranger@example.com',
        bootstrapAdminEmail: undefined,
        now,
        gateway: gatewayReturning(undefined),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('consumeInvitationFor', () => {
  it('marks the invitation consumed for an invited address', async () => {
    const gateway = gatewayReturning(pending);

    await consumeInvitationFor({ email: 'Invitee@Example.com', bootstrapAdminEmail, now, gateway });

    expect(gateway.markInvitationUsed).toHaveBeenCalledWith('invitee@example.com', now);
  });

  it('does not consume anything for the bootstrap administrator', async () => {
    const gateway = gatewayReturning(undefined);

    await consumeInvitationFor({ email: bootstrapAdminEmail, bootstrapAdminEmail, now, gateway });

    expect(gateway.markInvitationUsed).not.toHaveBeenCalled();
  });
});

describe('issueInvitation', () => {
  it('stores only the token digest and returns the token once for delivery', async () => {
    const gateway = gatewayReturning(undefined);

    const result = await issueInvitation({
      email: ' New@Example.com ',
      invitedBy: 'user-1',
      now,
      lifetimeHours: 72,
      gateway,
      generateId: () => 'invitation-1',
      generateToken: () => 'raw-token',
    });

    expect(result.token).toBe('raw-token');
    expect(result.email).toBe('new@example.com');

    const stored = vi.mocked(gateway.insertInvitation).mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      id: 'invitation-1',
      email: 'new@example.com',
      invitedBy: 'user-1',
      expiresAt: new Date('2026-07-31T10:00:00.000Z'),
    });
    expect(stored?.tokenHash).not.toBe('raw-token');
  });

  it('refuses to invite an address that already holds a pending invitation', async () => {
    await expect(
      issueInvitation({
        email: 'invitee@example.com',
        invitedBy: 'user-1',
        now,
        lifetimeHours: 72,
        gateway: gatewayReturning(pending),
        generateId: () => 'invitation-2',
        generateToken: () => 'raw-token',
      }),
    ).rejects.toThrow(/pending invitation/i);
  });

  it('allows re-inviting an address whose previous invitation was revoked', async () => {
    const gateway = gatewayReturning({
      ...pending,
      revokedAt: new Date('2026-07-27T10:00:00.000Z'),
    });

    await expect(
      issueInvitation({
        email: 'invitee@example.com',
        invitedBy: 'user-1',
        now,
        lifetimeHours: 72,
        gateway,
        generateId: () => 'invitation-3',
        generateToken: () => 'raw-token',
      }),
    ).resolves.toMatchObject({ email: 'invitee@example.com' });
  });
});
