import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import { registerServer } from './server';

describe('registerServer', () => {
  const original = process.env['SENTRY_DSN'];

  afterEach(() => {
    if (original === undefined) delete process.env['SENTRY_DSN'];
    else process.env['SENTRY_DSN'] = original;
    vi.mocked(Sentry.init).mockClear();
  });

  it('does NOT call Sentry.init when SENTRY_DSN is unset', () => {
    delete process.env['SENTRY_DSN'];
    registerServer();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init when SENTRY_DSN is set', () => {
    process.env['SENTRY_DSN'] = 'https://fake@example.ingest.sentry.io/1';
    registerServer();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
