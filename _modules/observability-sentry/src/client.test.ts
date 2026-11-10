import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import { initSentryClient } from './client';
import { SENTRY_DATA_COLLECTION } from './data-collection';

describe('initSentryClient', () => {
  const original = process.env['NEXT_PUBLIC_SENTRY_DSN'];

  afterEach(() => {
    if (original === undefined) delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
    else process.env['NEXT_PUBLIC_SENTRY_DSN'] = original;
    vi.mocked(Sentry.init).mockClear();
  });

  it('does NOT call Sentry.init when NEXT_PUBLIC_SENTRY_DSN is unset', () => {
    delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
    initSentryClient();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init when NEXT_PUBLIC_SENTRY_DSN is set', () => {
    process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://fake@example.ingest.sentry.io/1';
    initSentryClient();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dataCollection: SENTRY_DATA_COLLECTION }),
    );
    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]).not.toHaveProperty('sendDefaultPii');
  });
});
