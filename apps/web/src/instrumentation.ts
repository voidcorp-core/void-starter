/**
 * Next.js root instrumentation. Each opt-in observability module activates
 * at build time via env var presence (see docs/DECISIONS.md entry 04). When
 * the gating env var is unset, the dynamic import never runs and the module
 * stays out of the bundle.
 */
export async function register() {
  if (process.env['SENTRY_DSN']) {
    if (process.env['NEXT_RUNTIME'] === 'nodejs') {
      const { registerServer } = await import('@void/sentry/server');
      registerServer();
    }

    if (process.env['NEXT_RUNTIME'] === 'edge') {
      const { registerEdge } = await import('@void/sentry/edge');
      registerEdge();
    }
  }

  // PostHog client-side init lives in a Client Component, not here.
  // See @void/posthog README in Phase D.
}

export { onRequestError } from '@void/sentry/server';
