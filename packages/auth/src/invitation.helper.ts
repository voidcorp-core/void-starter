import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Pure helpers for the invite-only access mode (`auth.access_mode: invite_only`,
 * ADR 63).
 *
 * Everything here is synchronous, side-effect free and free of any database or
 * framework dependency, so the access decision itself can be unit-tested
 * exhaustively without a Postgres instance or a Better-Auth instance. The
 * effectful parts -- reading the ledger, minting a token, marking an invitation
 * consumed -- live in `invitation.repository.ts` and `invitation.service.ts`.
 *
 * `node:crypto` is a pure computation here: `createHash` maps an input to a
 * digest with no I/O and no observable state, which keeps `hashInvitationToken`
 * inside the helper layer rather than the service one.
 */

/**
 * Normalizes an address for storage and comparison: trimmed and lowercased.
 *
 * This is the join key between a stored invitation and the address arriving on
 * a sign-up, so it must be applied on both sides. Storing `Alice@Example.com`
 * while comparing `alice@example.com` would silently reject a legitimate
 * invitee; the reverse would let a case variant slip past a revocation.
 */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Hashes an invitation token with SHA-256.
 *
 * Only the digest is persisted. The token is a bearer credential mailed to the
 * invitee, so a leaked `invitations` row must not be redeemable: the attacker
 * would hold a digest, not a link. SHA-256 without a salt is the right
 * primitive here (unlike for passwords) because the token is a high-entropy
 * random value, not a guessable secret, so a rainbow table has nothing to
 * precompute.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether a presented token is the one an invitation was issued with.
 *
 * Compared in constant time: the digests are fixed-length, so an early-exit
 * comparison would leak how many leading characters a guess got right, which is
 * exactly the feedback an attacker needs to walk a token one character at a
 * time. `timingSafeEqual` throws on differing lengths, so the length is checked
 * first -- a length mismatch is not a secret, it just means the input was never
 * a SHA-256 digest.
 */
export function matchesInvitationToken(presentedToken: string, storedHash: string): boolean {
  const presented = Buffer.from(hashInvitationToken(presentedToken), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

/**
 * Name of the cookie that carries the invitation token from the link the
 * invitee opened to whichever endpoint then creates their account.
 *
 * A cookie rather than a request field because account creation happens on
 * three different endpoints -- email sign-up, magic link, and a social provider
 * callback that returns from an external redirect with no body of ours. A
 * cookie is the only carrier all three share, and the social callback in
 * particular cannot carry anything else.
 */
export const INVITATION_COOKIE_NAME = 'void_invitation';

/**
 * Extracts the invitation token from a raw `Cookie` header.
 *
 * Kept pure and separate from the hook so the parsing is unit-testable without
 * a Better Auth instance. Returns undefined for a missing or empty value rather
 * than an empty string, so the caller cannot mistake "present but blank" for a
 * presented token.
 */
export function readInvitationCookie(
  cookieHeader: string | undefined, // allow-null: Headers.get returns null at the framework boundary
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== INVITATION_COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** Computes an expiry instant without mutating the reference instant. */
export function invitationExpiryFrom(now: Date, lifetimeHours: number): Date {
  return new Date(now.getTime() + lifetimeHours * 60 * 60 * 1000);
}

/**
 * Why an invitation may or may not be redeemed. Distinguishing the reasons is
 * for logs and the admin screen only -- every non-`usable` state produces the
 * same opaque refusal to the visitor, so the endpoint never reveals whether an
 * address was ever invited (enumeration protection, docs/SECURITY.md).
 */
export type InvitationState = 'absent' | 'usable' | 'used' | 'revoked' | 'expired';

/**
 * The timestamp trio the decision reads. Nullable rather than optional because
 * this is the shape Drizzle infers for the nullable columns of `invitations`,
 * and re-mapping it at the repository boundary would buy nothing but a copy.
 */
export type InvitationTimestamps = {
  expiresAt: Date;
  usedAt: Date | null; // allow-null: Drizzle $inferSelect shape for a nullable column
  revokedAt: Date | null; // allow-null: Drizzle $inferSelect shape for a nullable column
};

/**
 * Decides whether a ledger row admits an account creation.
 *
 * Precedence is deliberate and pinned by tests: consumption wins over
 * revocation (the account already exists, so reporting `revoked` would be a
 * lie), and revocation wins over expiry (a deliberate withdrawal is more
 * informative to an administrator than the clock running out). The expiry
 * comparison is inclusive so an invitation is not refused on its exact
 * boundary instant.
 */
export function resolveInvitationState(
  invitation: InvitationTimestamps | undefined,
  now: Date,
): InvitationState {
  if (!invitation) return 'absent';
  if (invitation.usedAt) return 'used';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt.getTime() < now.getTime()) return 'expired';
  return 'usable';
}
