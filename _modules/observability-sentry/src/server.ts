import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * Initialize the Sentry Node SDK on the server runtime.
 *
 * Called from `apps/web/src/instrumentation.ts` when `process.env.NEXT_RUNTIME`
 * is `'nodejs'` AND `SENTRY_DSN` is set. Returns silently when the DSN is
 * absent so build steps without Sentry env vars stay quiet.
 */
export function registerServer(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
    sendDefaultPii: true,
  });
}

/**
 * Re-export of `Sentry.captureRequestError` for use as the
 * `onRequestError` instrumentation hook required by Next.js 15+ App Router.
 *
 * Consumers re-export this from `apps/web/src/instrumentation.ts`.
 */
export const onRequestError = Sentry.captureRequestError;
