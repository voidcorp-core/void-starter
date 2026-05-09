import * as Sentry from '@sentry/nextjs';

/**
 * Initialize the Sentry SDK in the browser.
 *
 * This file is consumed from `apps/web/src/instrumentation-client.ts`. Do NOT
 * add `'use client'` here: `instrumentation-client.ts` is not a React
 * component, it is a Next.js client-instrumentation hook that runs before any
 * React tree mounts.
 *
 * The DSN comes from `NEXT_PUBLIC_SENTRY_DSN` so the value is build-time
 * inlined and the entire `Sentry.init` block dead-code-eliminates when the
 * env var is unset at build time.
 */
export function initSentryClient(): void {
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
    sendDefaultPii: true,
    // The tunnel route is configured in next.config.ts via
    // withSentryConfig(..., { tunnelRoute: '/sentry-tunnel' }).
  });
}

/**
 * Required by `@sentry/nextjs` 10.x to instrument App Router navigation
 * transitions. Must be re-exported from `instrumentation-client.ts` as a
 * top-level export named `onRouterTransitionStart` for Next.js to pick it up.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
