/**
 * `@void/posthog` is consumed exclusively through its `/client` subpath:
 *
 *   import { AnalyticsProvider } from '@void/posthog/client';
 *
 * The barrel intentionally re-exports nothing: `AnalyticsProvider` is a
 * `'use client'` boundary, and re-exporting it from the package root would
 * tempt server-side import sites into pulling the browser-only PostHog SDK
 * into their bundle. Subpath imports keep the runtime boundary explicit at
 * every call site.
 *
 * See README.md for installation, removal, and the EU reverse-proxy setup.
 */
export {};
