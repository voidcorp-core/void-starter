// The dedicated subpath, never the `@repo/auth` barrel: the barrel re-exports
// `auth.service.ts`, which carries `server-only`. This route needs one constant
// and nothing else, and staying off the barrel keeps it unit-testable.
import { INVITATION_COOKIE_NAME } from '@repo/auth/invitation-helper';
import { logger } from '@repo/core/logger';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Entry point of an invitation link (ADR 65).
 *
 * The invitee opens `/invite/<token>`; this parks the token in a short-lived
 * cookie and sends them to the sign-up form. Account creation then reads that
 * cookie in the user-create hook, whichever endpoint performs it.
 *
 * The token is moved out of the URL on purpose. Left as a query parameter it
 * would survive in browser history, in the `Referer` sent to any third party
 * the sign-up page loads, and in the logs of every proxy on the way -- for a
 * credential that grants account creation. The redirect also means the address
 * bar stops showing it as soon as the page renders.
 *
 * No ledger lookup happens here: this route deliberately cannot tell the
 * visitor whether the token is real. Answering that before an account is
 * attempted would turn the link into an oracle for which invitations exist.
 * The single decision point stays the user-create hook.
 */

/** One hour: long enough to complete a sign-up, short enough not to linger. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * Tokens are `randomBytes(32).toString('base64url')`, so 43 characters of the
 * base64url alphabet. Rejecting anything else keeps a malformed or hostile
 * value from ever reaching the cookie.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  // Derived from the request rather than a configured origin, so the redirect
  // is correct on every deployment URL a project actually answers on.
  const signUp = new URL('/sign-up', request.nextUrl.origin);

  if (!TOKEN_PATTERN.test(token)) {
    logger.warn('invitation link rejected on token shape');
    return NextResponse.redirect(signUp);
  }

  const response = NextResponse.redirect(signUp);
  response.cookies.set({
    name: INVITATION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    // Tied to the scheme actually serving the request: a plain `production`
    // check would drop the cookie on a local HTTP run of a production build.
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
