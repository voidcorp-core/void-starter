/**
 * Browser-side instrumentation hook. Next.js loads this file before the React
 * tree mounts.
 *
 * The check on `NEXT_PUBLIC_SENTRY_DSN` is build-time inlined, so when the
 * env var is unset the dynamic import never resolves and the entire Sentry
 * runtime stays out of the client bundle (docs/DECISIONS.md entry 04). When
 * the DSN is set, the import resolves and `Sentry.init` runs.
 */
if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
  import('@void/sentry/client').then(({ initSentryClient }) => {
    initSentryClient();
  });
}
