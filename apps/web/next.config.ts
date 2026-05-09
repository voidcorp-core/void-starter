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
  transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/ui'],
};

export default config;
