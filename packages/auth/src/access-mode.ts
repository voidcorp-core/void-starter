/**
 * The access mode this project was generated with (ADR 63).
 *
 * This file is REWRITTEN by the factory from `auth.access_mode` in the
 * manifest. It is code, not configuration, and that is the point: the
 * restriction cannot be lifted by editing an environment variable in a provider
 * dashboard, only by changing the manifest and redeploying. An `invite_only`
 * project that could be turned public from a settings page would be making a
 * promise its runtime does not keep.
 *
 * The baseline value below is the one the starter itself ships with. Every
 * generated project gets its own value written at composition time.
 *
 * Modes:
 *   - `public_verified` -- anyone may sign up; the address must be verified
 *     before the account is usable. The starter default.
 *   - `invite_only` -- an account is created only for the bootstrap
 *     administrator or an address holding a pending invitation. Enforced in
 *     `auth.repository.ts` through `invitation.service.ts`.
 *   - `public_signup_gated_activation` -- anyone may sign up, but an
 *     administrator activates the account. Declared in the manifest schema; not
 *     yet materialized (see docs/FACTORY.md section 7).
 *   - `none` -- no auth provider selected, so no account exists at all.
 */
export type AccessMode =
  | 'public_verified'
  | 'invite_only'
  | 'public_signup_gated_activation'
  | 'none';

export const ACCESS_MODE: AccessMode = 'public_verified';

/** Whether account creation requires an invitation in this project. */
export function isInviteOnly(mode: AccessMode = ACCESS_MODE): boolean {
  return mode === 'invite_only';
}
