import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// In Next 16, middleware.ts was renamed to proxy.ts and the export was renamed
// from `middleware` to `proxy`. The runtime config option is not available in
// proxy files — do not add it.
export function proxy(_request: NextRequest) {
  // Session refresh / rate-limit / locale detection slots.
  // Phase D modules (rate-limit-upstash) plug in here.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
