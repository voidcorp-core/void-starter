'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { type ReactNode, useEffect } from 'react';

/**
 * Client-side PostHog provider for void-starter MVPs.
 *
 * Reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` at runtime.
 * Both vars are `NEXT_PUBLIC_*` so they get build-time inlined; when the key
 * is absent at build time, the entire SDK init branch dead-code-eliminates
 * (Turbopack caveat: the runtime `if (!key) return;` check is preserved, but
 * the SDK is never fetched on the wire).
 *
 * The default `host` of `/ingest` matches the EU reverse-proxy rewrites that
 * `apps/web/next.config.ts` ships with. Override it only if you point to a
 * different region or proxy path.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const key = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
  const host = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? '/ingest';

  useEffect(() => {
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
    });
  }, [key, host]);

  if (!key) return <>{children}</>;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
