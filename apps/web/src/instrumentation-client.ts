/**
 * Browser-side instrumentation hook. Next.js loads this file before the React
 * tree mounts.
 *
 * The check on `NEXT_PUBLIC_SENTRY_DSN` is build-time inlined, so when the
 * env var is unset the dynamic import never resolves and the entire Sentry
 * runtime stays out of the client bundle (docs/DECISIONS.md entry 04). When
 * the DSN is set, the import resolves and `Sentry.init` runs.
 *
 * Build-time note: `@sentry/nextjs` 10.x emits a soft "ACTION REQUIRED"
 * warning advising consumers to re-export `onRouterTransitionStart` from
 * THIS file. We deliberately do not, because doing so eagerly imports
 * `@sentry/nextjs` at module top and defeats the gate above (the SDK ships
 * into the bundle even when the DSN is unset). The warning is acknowledged
 * and documented in `_modules/observability-sentry/README.md`. Navigation
 * transition spans are simply not captured under this trade-off; client
 * exception capture and tracing on requests still work via `Sentry.init`.
 */
if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
  import('@void/sentry/client')
    .then(({ initSentryClient }) => {
      initSentryClient();
    })
    .catch(() => {
      // Swallow: a chunk-load failure here means Sentry will not capture
      // browser errors, but the rest of the app stays functional. There is
      // no useful action to take in the user's tab, and surfacing the
      // failure would itself require Sentry.
    });
}
