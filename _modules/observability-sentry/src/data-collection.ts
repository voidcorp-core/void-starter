import type * as Sentry from '@sentry/nextjs';

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>['dataCollection']>;

/**
 * What the Sentry SDK may send, shared by the browser, Node and Edge inits.
 *
 * Sentry 11 replaced `sendDefaultPii` with `dataCollection`, and leaving it
 * unset now collects every HTTP body and every bound database parameter. The
 * SDK's built-in key filter masks cookies, auth headers and token-like query
 * parameters, but not the values inside a body or a SQL parameter, where
 * Better Auth carries passwords and verification tokens. Those channels are
 * closed here; user attribution, cookies and headers keep the v11 defaults,
 * which match the previous `sendDefaultPii: true`.
 */
export const SENTRY_DATA_COLLECTION = {
  httpBodies: [],
  databaseQueryData: false,
  queues: false,
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
} as const satisfies DataCollection;
