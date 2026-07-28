import { describe, expect, it } from 'vitest';
import {
  hashInvitationToken,
  type InvitationState,
  invitationExpiryFrom,
  normalizeInvitationEmail,
  resolveInvitationState,
} from './invitation.helper';

describe('normalizeInvitationEmail', () => {
  it('trims and lowercases so a case difference cannot open a second door', () => {
    expect(normalizeInvitationEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('is idempotent, so a stored value normalizes to itself', () => {
    const once = normalizeInvitationEmail(' Bob@Example.com');
    expect(normalizeInvitationEmail(once)).toBe(once);
  });

  it('leaves an already normalized address untouched', () => {
    expect(normalizeInvitationEmail('carol@example.com')).toBe('carol@example.com');
  });
});

describe('hashInvitationToken', () => {
  it('is deterministic for the same token', () => {
    expect(hashInvitationToken('token-abc')).toBe(hashInvitationToken('token-abc'));
  });

  it('produces a different digest for a different token', () => {
    expect(hashInvitationToken('token-abc')).not.toBe(hashInvitationToken('token-abd'));
  });

  it('never returns the token itself, so a leaked row is not a usable credential', () => {
    const token = 'token-abc';
    const hash = hashInvitationToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });
});

describe('invitationExpiryFrom', () => {
  it('adds the requested lifetime to the reference instant', () => {
    const now = new Date('2026-07-28T10:00:00.000Z');
    expect(invitationExpiryFrom(now, 72).toISOString()).toBe('2026-07-31T10:00:00.000Z');
  });

  it('does not mutate the reference instant', () => {
    const now = new Date('2026-07-28T10:00:00.000Z');
    invitationExpiryFrom(now, 24);
    expect(now.toISOString()).toBe('2026-07-28T10:00:00.000Z');
  });
});

describe('resolveInvitationState', () => {
  const now = new Date('2026-07-28T10:00:00.000Z');
  const pending = {
    expiresAt: new Date('2026-07-29T10:00:00.000Z'),
    usedAt: null,
    revokedAt: null,
  };

  it('reports a missing invitation as absent', () => {
    expect(resolveInvitationState(undefined, now)).toBe<InvitationState>('absent');
  });

  it('reports a pending, unexpired invitation as usable', () => {
    expect(resolveInvitationState(pending, now)).toBe<InvitationState>('usable');
  });

  it('reports a consumed invitation as used, so a link cannot be replayed', () => {
    expect(
      resolveInvitationState({ ...pending, usedAt: new Date('2026-07-28T09:00:00.000Z') }, now),
    ).toBe<InvitationState>('used');
  });

  it('reports a revoked invitation as revoked even when it has not expired', () => {
    expect(
      resolveInvitationState({ ...pending, revokedAt: new Date('2026-07-28T09:00:00.000Z') }, now),
    ).toBe<InvitationState>('revoked');
  });

  it('reports an expired invitation as expired', () => {
    expect(
      resolveInvitationState({ ...pending, expiresAt: new Date('2026-07-28T09:59:59.999Z') }, now),
    ).toBe<InvitationState>('expired');
  });

  it('treats the exact expiry instant as still usable rather than already expired', () => {
    expect(resolveInvitationState({ ...pending, expiresAt: now }, now)).toBe<InvitationState>(
      'usable',
    );
  });

  it('prefers revoked over expired when both apply, because revocation is deliberate', () => {
    expect(
      resolveInvitationState(
        {
          expiresAt: new Date('2026-07-27T10:00:00.000Z'),
          usedAt: null,
          revokedAt: new Date('2026-07-27T09:00:00.000Z'),
        },
        now,
      ),
    ).toBe<InvitationState>('revoked');
  });

  it('prefers used over revoked when both apply, because consumption came first', () => {
    expect(
      resolveInvitationState(
        {
          expiresAt: new Date('2026-07-29T10:00:00.000Z'),
          usedAt: new Date('2026-07-27T09:00:00.000Z'),
          revokedAt: new Date('2026-07-27T10:00:00.000Z'),
        },
        now,
      ),
    ).toBe<InvitationState>('used');
  });
});
