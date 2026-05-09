import { withSentryConfig } from '@sentry/nextjs';
import { defaultSecurityHeaders } from '@void/core/security-headers';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // cacheComponents was promoted from experimental to stable in Next 16.0.0.
  // It controls ppr, useCache, and dynamicIO as a single unified configuration.
  cacheComponents: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: defaultSecurityHeaders(),
      },
    ];
  },
  transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/sentry', '@void/ui'],
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
