import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError } from '@repo/core/errors'; // allow-boundary: @repo/core is the always-allowed base of the graph
import { logger } from '@repo/core/logger'; // allow-boundary: @repo/core is the always-allowed base of the graph
import {
  hashInvitationToken,
  type InvitationTimestamps,
  invitationExpiryFrom,
  matchesInvitationToken,
  normalizeInvitationEmail,
  resolveInvitationState,
} from './invitation.helper';
import {
  findLatestInvitationByEmail,
  insertInvitation,
  listInvitations,
  markInvitationUsed,
  revokeInvitation,
} from './invitation.repository';

/**
 * Access decisions for `auth.access_mode: invite_only` (ADR 63).
 *
 * This is the layer Better-Auth's user-create hooks call. It owns the rule --
 * who may hold an account -- while the ledger reads and writes stay in
 * `invitation.repository.ts` and the state machine stays pure in
 * `invitation.helper.ts`.
 *
 * The repository arrives as a parameter rather than a module import so the rule
 * is testable without Postgres and so a consuming app can substitute its own
 * ledger (function-parameter injection, docs/ARCHITECTURE.md). The default
 * gateway is assembled in `auth.repository.ts`, which is the only place that
 * knows both the rule and the concrete adapter.
 */

/** The ledger operations the rule needs. Implemented by `invitation.repository.ts`. */
export type InvitationGateway = {
  findLatestInvitationByEmail(
    normalizedEmail: string,
  ): Promise<(InvitationTimestamps & { tokenHash: string }) | undefined>;
  markInvitationUsed(normalizedEmail: string, usedAt: Date): Promise<boolean>;
  insertInvitation(row: {
    id: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string;
  }): Promise<unknown>;
};

type AdmissionInput = {
  email: string;
  bootstrapAdminEmail: string | undefined;
  now: Date;
  gateway: InvitationGateway;
  /**
   * The raw token the visitor presented, carried from the invitation link.
   * Absent means no link was followed, which is a refusal for anyone but the
   * bootstrap administrator.
   */
  presentedToken?: string | undefined;
};

/**
 * Every refusal carries this exact message.
 *
 * Uniform on purpose: telling an absent address from a revoked or expired one
 * would turn the sign-up endpoint into an oracle for who works here, which is
 * the enumeration leak docs/SECURITY.md forbids. The distinguishing reason goes
 * to the structured log instead, where only an operator can read it.
 */
const REFUSAL_MESSAGE = 'This application is invite-only and this address is not invited.';

/** Whether an address is the configured bootstrap administrator. */
function isBootstrapAdministrator(
  normalizedEmail: string,
  bootstrapAdminEmail: string | undefined,
): boolean {
  if (!bootstrapAdminEmail) return false;
  return normalizedEmail === normalizeInvitationEmail(bootstrapAdminEmail);
}

/**
 * Throws unless the address may create an account.
 *
 * The bootstrap administrator is admitted without a ledger lookup, which is
 * what makes the first account possible on a tool where nobody can invite yet.
 * Every other address must hold a pending, unexpired, unrevoked invitation AND
 * present the token that invitation was issued with.
 *
 * Requiring the token is what makes the invitation a credential rather than a
 * list membership. Admitting on the address alone would let anyone who guesses
 * an invited address -- trivial where addresses follow a company pattern --
 * create that account first. They could not sign in, since verification still
 * applies, but the post-creation hook would consume the invitation, so the
 * legitimate invitee would find their address taken and their invitation spent,
 * repeatably.
 */
export async function assertSignUpAdmitted(input: AdmissionInput): Promise<void> {
  const normalizedEmail = normalizeInvitationEmail(input.email);

  if (isBootstrapAdministrator(normalizedEmail, input.bootstrapAdminEmail)) return;

  const invitation = await input.gateway.findLatestInvitationByEmail(normalizedEmail);
  const state = resolveInvitationState(invitation, input.now);

  if (state === 'usable' && invitation) {
    if (
      input.presentedToken &&
      matchesInvitationToken(input.presentedToken, invitation.tokenHash)
    ) {
      return;
    }
    // Separated from `state` in the log so an operator can tell a stranger from
    // an invitee who lost their link; the visitor sees one message either way.
    logger.warn(
      { state, reason: input.presentedToken ? 'token-mismatch' : 'token-absent' },
      'invite-only sign-up refused',
    );
    throw new ForbiddenError(REFUSAL_MESSAGE);
  }

  logger.warn({ state }, 'invite-only sign-up refused');
  throw new ForbiddenError(REFUSAL_MESSAGE);
}

/**
 * Consumes the invitation that admitted an account creation.
 *
 * Called after the account exists, never before: consuming in the pre-creation
 * hook would burn the invitation whenever creation then failed, locking a
 * legitimate invitee out with no way back except an administrator re-invite.
 * The bootstrap administrator has no invitation to consume.
 */
export async function consumeInvitationFor(input: AdmissionInput): Promise<void> {
  const normalizedEmail = normalizeInvitationEmail(input.email);

  if (isBootstrapAdministrator(normalizedEmail, input.bootstrapAdminEmail)) return;

  const consumed = await input.gateway.markInvitationUsed(normalizedEmail, input.now);
  if (!consumed) {
    // Not fatal: the account exists and the admission rule already passed. This
    // means the row moved between admission and consumption, which an operator
    // should see rather than a visitor.
    logger.warn('invite-only invitation had nothing left to consume after account creation');
  }
}

type IssueInput = {
  email: string;
  invitedBy: string;
  now: Date;
  lifetimeHours: number;
  gateway: InvitationGateway;
  generateId: () => string;
  generateToken: () => string;
};

/**
 * Issues an invitation and returns the raw token exactly once.
 *
 * The token is returned to the caller for delivery and never persisted in
 * clear; only its digest reaches the database. A pending invitation blocks a
 * second one for the same address, which matches the partial unique index and
 * keeps the ledger's meaning single-valued -- re-inviting requires revoking
 * first, so an administrator cannot silently multiply live links.
 */
export async function issueInvitation(input: IssueInput): Promise<{
  id: string;
  email: string;
  token: string;
  expiresAt: Date;
}> {
  const normalizedEmail = normalizeInvitationEmail(input.email);
  const existing = await input.gateway.findLatestInvitationByEmail(normalizedEmail);

  if (resolveInvitationState(existing, input.now) === 'usable') {
    throw new ConflictError(
      'This address already holds a pending invitation. Revoke it before issuing another.',
    );
  }

  const token = input.generateToken();
  const id = input.generateId();
  const expiresAt = invitationExpiryFrom(input.now, input.lifetimeHours);

  await input.gateway.insertInvitation({
    id,
    email: normalizedEmail,
    tokenHash: hashInvitationToken(token),
    expiresAt,
    invitedBy: input.invitedBy,
  });

  return { id, email: normalizedEmail, token, expiresAt };
}

/**
 * The ledger backed by the real `invitations` table. Exported so
 * `auth.repository.ts` can hand it to the Better-Auth hooks without assembling
 * its own copy, while tests keep injecting their own.
 */
export const defaultInvitationGateway: InvitationGateway = {
  findLatestInvitationByEmail,
  markInvitationUsed,
  insertInvitation,
};

/**
 * Default invitation lifetime. Three days is long enough to survive a weekend
 * and short enough that a forwarded mail does not stay redeemable for months.
 */
const DEFAULT_LIFETIME_HOURS = 72;

/**
 * Issues an invitation against the real ledger. The thin wrapper an admin
 * Server Action calls: it supplies the clock, the identifiers and the token
 * source that `issueInvitation` takes as parameters for testability.
 *
 * `randomBytes(32)` is a cryptographically secure source, which matters because
 * the token is the bearer credential in the mailed link.
 */
export async function issueInvitationForAdmin(input: {
  email: string;
  invitedBy: string;
  lifetimeHours?: number;
}): Promise<{ id: string; email: string; token: string; expiresAt: Date }> {
  return issueInvitation({
    email: input.email,
    invitedBy: input.invitedBy,
    now: new Date(),
    lifetimeHours: input.lifetimeHours ?? DEFAULT_LIFETIME_HOURS,
    gateway: defaultInvitationGateway,
    generateId: () => randomUUID(),
    generateToken: () => randomBytes(32).toString('base64url'),
  });
}

/**
 * Revokes the pending invitation for an address. Returns false when there was
 * nothing pending, which the caller surfaces as a no-op rather than an error:
 * revoking an already revoked invitation is the outcome the administrator
 * wanted either way.
 */
export async function revokeInvitationFor(email: string): Promise<boolean> {
  return revokeInvitation(normalizeInvitationEmail(email), new Date());
}

/**
 * Lists invitations for the admin screen, each resolved to its current state so
 * the view renders a status rather than re-deriving one from three timestamps.
 * The service layer exists here purely to keep the component off the
 * repository, per the layering rule in docs/PATTERNS.md.
 */
export async function listInvitationsForAdmin(limit?: number): Promise<
  Array<{
    id: string;
    email: string;
    state: ReturnType<typeof resolveInvitationState>;
    expiresAt: Date;
    createdAt: Date;
  }>
> {
  const now = new Date();
  const rows = await listInvitations(limit);
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    state: resolveInvitationState(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}
