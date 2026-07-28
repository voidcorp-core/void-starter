'use server';

import { defineAction, issueInvitationForAdmin, revokeInvitationFor } from '@repo/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Administration of the invite-only access ledger (ADR 63).
 *
 * These actions exist only in a project generated with
 * `auth.access_mode: invite_only`; the factory prunes this file otherwise. Both
 * are `auth: 'role:admin'`, so issuing or revoking an invitation is an
 * administrator action even though the enforcement itself happens in
 * `@repo/auth`'s user-create hooks.
 *
 * The issued token is returned to the caller for delivery and is never
 * persisted in clear (only its SHA-256 digest reaches the database), so this
 * response is the single moment the link exists in readable form.
 */

const emailSchema = z.object({
  email: z.email().max(320),
});

/**
 * Issues an invitation for an address and returns the redeemable token.
 *
 * A pending invitation for the same address is refused rather than replaced:
 * silently minting a second live link would leave two credentials valid for one
 * seat, and revoking one would not close the other.
 */
export const issueInvitationAction = defineAction({
  schema: emailSchema,
  auth: 'role:admin',
  handler: async (input, ctx) => {
    const invitation = await issueInvitationForAdmin({
      email: input.email,
      invitedBy: ctx.user.id,
    });

    revalidatePath('/admin/invitations');

    return {
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      token: invitation.token,
    };
  },
});

/**
 * Revokes the pending invitation for an address.
 *
 * Reports `revoked: false` when nothing was pending rather than failing: the
 * administrator's intent -- that this address must not be able to sign up -- is
 * satisfied either way, and an error would only invite a confusing retry.
 */
export const revokeInvitationAction = defineAction({
  schema: emailSchema,
  auth: 'role:admin',
  handler: async (input) => {
    const revoked = await revokeInvitationFor(input.email);
    revalidatePath('/admin/invitations');
    return { revoked };
  },
});
