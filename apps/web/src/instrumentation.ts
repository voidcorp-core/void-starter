export async function register() {
  // Opt-in observability and analytics modules register here.
  // Each conditional dynamic import keeps the module out of the bundle when its
  // env var is not set at build time.

  if (process.env['SENTRY_DSN']) {
    // Phase D installs @void/sentry and uncomments this:
    // const { register: registerSentry } = await import('@void/sentry/server');
    // await registerSentry();
  }

  // PostHog client-side init lives in a Client Component, not here.
  // See @void/posthog README in Phase D.
}
