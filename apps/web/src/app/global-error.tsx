'use client';

import { useEffect } from 'react';

/**
 * Root-level error boundary required by Next.js App Router. This page renders
 * when an error escapes the root layout itself; per-route `error.tsx` handles
 * errors inside routes.
 *
 * The Sentry import is dynamic and gated on `NEXT_PUBLIC_SENTRY_DSN` so the
 * SDK never ships in the bundle when the env var is unset (build-time DCE,
 * docs/DECISIONS.md entry 04). When the DSN is set, the dynamic import
 * resolves before `Sentry.captureException` runs.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
      import('@sentry/nextjs').then((Sentry) => {
        Sentry.captureException(error);
      });
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            maxWidth: '32rem',
            margin: '4rem auto',
            padding: '0 1.5rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#666' }}>An unexpected error occurred. Please try again.</p>
          {error.digest ? (
            <p style={{ color: '#999', fontSize: '0.875rem', marginTop: '0.75rem' }}>
              Error ID: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
