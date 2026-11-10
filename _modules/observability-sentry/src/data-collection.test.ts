import { describe, expect, it } from 'vitest';
import { SENTRY_DATA_COLLECTION } from './data-collection';

// Sentry 11 collects request bodies and database parameters when
// `dataCollection` is left unset. Its built-in key filter already masks
// cookies, auth headers and token-like query parameters, but not the values
// inside a body or a bound SQL parameter: Better Auth sends passwords in
// request bodies and stores verification tokens through Drizzle.
describe('SENTRY_DATA_COLLECTION', () => {
  it('collects no HTTP body', () => {
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
  });

  it('collects no database query data, queue payload or AI content', () => {
    expect(SENTRY_DATA_COLLECTION.databaseQueryData).toBe(false);
    expect(SENTRY_DATA_COLLECTION.queues).toBe(false);
    expect(SENTRY_DATA_COLLECTION.genAI).toEqual({ inputs: false, outputs: false });
    expect(SENTRY_DATA_COLLECTION.mcp).toEqual({ inputs: false, outputs: false });
  });

  it('leaves user, cookie and header collection to the v11 defaults', () => {
    expect(SENTRY_DATA_COLLECTION).not.toHaveProperty('userInfo');
    expect(SENTRY_DATA_COLLECTION).not.toHaveProperty('cookies');
    expect(SENTRY_DATA_COLLECTION).not.toHaveProperty('httpHeaders');
  });
});
