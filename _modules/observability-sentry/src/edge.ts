import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * Initialize the Sentry SDK on the Edge runtime (Routing Middleware, Edge
 * Functions). Called from `apps/web/src/instrumentation.ts` when
 * `process.env.NEXT_RUNTIME` is `'edge'` AND `SENTRY_DSN` is set.
 */
export function registerEdge(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
    sendDefaultPii: true,
  });
}
