'use client';

import { type ReactNode, useEffect } from 'react';

/**
 * Client-side PostHog initializer for void-starter MVPs.
 *
 * Reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`. When the key
 * is absent, the SDK is never loaded: `posthog-js` is pulled in through a
 * DYNAMIC `import()` inside the effect, gated on the key, so it never enters
 * the eager client bundle (~190KB) for a deploy that has not configured
 * PostHog. This mirrors the Sentry dynamic-import gate (ADR 27): Turbopack
 * does not reliably dead-code-eliminate `NEXT_PUBLIC_*` branches across module
 * boundaries, so a static `import posthog from 'posthog-js'` would ship the
 * SDK regardless of the key. The dynamic gate is what actually buys the
 * zero-bundle promise. See ADR 32.
 *
 * Initialization targets the global `posthog` singleton (the standard 2026
 * pattern). Components capture events via `import posthog from 'posthog-js'`,
 * which only bundles the SDK in projects that actually use it. The component
 * always renders its children unchanged, so it is safe to mount unconditionally
 * in the root layout.
 *
 * The default `host` of `/ingest` matches the EU reverse-proxy rewrites that
 * `apps/web/next.config.ts` ships with (ADR 28). Override it only if you point
 * to a different region or proxy path.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const key = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
  const host = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? '/ingest';

  useEffect(() => {
    if (!key) return;
    let active = true;
    void import('posthog-js').then(({ default: posthog }) => {
      if (!active) return;
      posthog.init(key, {
        api_host: host,
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-01-30',
        person_profiles: 'identified_only',
      });
    });
    return () => {
      active = false;
    };
  }, [key, host]);

  return <>{children}</>;
}
