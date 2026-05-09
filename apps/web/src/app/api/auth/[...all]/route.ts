import { getAuth } from '@void/auth/repository';
import { toNextJsHandler } from 'better-auth/next-js';

// Lazy handler: `getAuth()` validates env vars on first call (not at module
// load time), so `next build` can run without auth env vars being present.
// `getAuth()` is memoized, so `toNextJsHandler` receives the same instance on
// every request after the first.
export const GET = (req: Request) => toNextJsHandler(getAuth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(getAuth()).POST(req);
