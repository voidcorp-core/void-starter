/**
 * `@repo/sentry` is consumed exclusively through its subpath exports:
 *
 *   import { registerServer, onRequestError } from '@repo/sentry/server';
 *   import { registerEdge } from '@repo/sentry/edge';
 *   import { initSentryClient } from '@repo/sentry/client';
 *
 * The barrel intentionally re-exports nothing: the server and edge entries
 * carry `import 'server-only'`, and re-exporting them here would taint any
 * consumer that imports `@repo/sentry` from a client component. Subpath
 * imports keep the runtime boundary explicit at every call site.
 *
 * See README.md for installation and removal steps.
 */
export {};
