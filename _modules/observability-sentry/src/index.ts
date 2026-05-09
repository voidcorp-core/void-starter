/**
 * `@void/sentry` is consumed exclusively through its subpath exports:
 *
 *   import { registerServer, onRequestError } from '@void/sentry/server';
 *   import { registerEdge } from '@void/sentry/edge';
 *   import { initSentryClient } from '@void/sentry/client';
 *
 * The barrel intentionally re-exports nothing: the server and edge entries
 * carry `import 'server-only'`, and re-exporting them here would taint any
 * consumer that imports `@void/sentry` from a client component. Subpath
 * imports keep the runtime boundary explicit at every call site.
 *
 * See README.md for installation and removal steps.
 */
export {};
