import { withSentryConfig } from '@sentry/nextjs';
import { defaultSecurityHeaders } from '@void/core/security-headers';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // cacheComponents was promoted from experimental to stable in Next 16.0.0.
  // It controls ppr, useCache, and dynamicIO as a single unified configuration.
  cacheComponents: true,
  // Required by the PostHog reverse-proxy rewrites below: without it Next.js
  // issues a 308 trailing-slash redirect on /ingest/... before the rewrite
  // runs, which breaks the proxy. See _modules/analytics-posthog/README.md.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: defaultSecurityHeaders(),
      },
    ];
  },
  // Reverse-proxy PostHog through the deploy origin so ad blockers and CSP
  // connect-src rules don't drop analytics traffic. The destination region
  // (eu vs us) must match the PostHog project the key was issued in.
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ];
  },
  transpilePackages: [
    '@void/auth',
    '@void/core',
    '@void/db',
    '@void/posthog',
    '@void/sentry',
    '@void/ui',
  ],
};

// withSentryConfig is always applied; when SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN
// are unset the Sentry runtime never initializes (see _modules/observability-sentry).
// Source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT and
// silently no-ops without them. The tunnel route is auto-wired by Sentry's
// webpack plugin from the tunnelRoute option below.
export default withSentryConfig(config, {
  tunnelRoute: '/sentry-tunnel',
  silent: !process.env['CI'],
});
