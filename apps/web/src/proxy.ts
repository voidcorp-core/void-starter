import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// In Next 16, middleware.ts was renamed to proxy.ts and the export was renamed
// from `middleware` to `proxy`. The runtime config option is not available in
// proxy files — do not add it.
export function proxy(request: NextRequest) {
  // Expose the requested path to Server Components via a request header. Next
  // does not surface the pathname in RSC, so page-level guards (requireAuth in
  // @repo/auth) read `x-pathname` to build the post-login `?callbackURL` (ADR 35).
  // Also the session refresh / rate-limit / locale detection slot -- Phase D
  // modules (rate-limit-upstash) plug in here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
