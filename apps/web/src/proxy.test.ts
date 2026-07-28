import { describe, expect, it } from 'vitest';
import { config } from './proxy';

/**
 * The matcher is a security- and correctness-relevant boundary, so it is asserted
 * as behaviour rather than eyeballed: each entry is compiled and probed with the
 * paths that must (and must not) reach the proxy.
 */
function matches(path: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));
}

describe('proxy matcher', () => {
  it.each(['/', '/dashboard', '/notes', '/admin'])('runs on the application path %s', (path) => {
    expect(matches(path)).toBe(true);
  });

  // Intercepting the Workflow SDK's internal resume endpoint corrupts the queue
  // payload and silently breaks durable runs.
  it.each(['/.well-known/workflow/v1/flow', '/.well-known/workflow/v1/step'])(
    'never intercepts the workflow internal path %s',
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );

  it.each(['/api/auth/session', '/_next/static/chunk.js', '/_next/image', '/favicon.ico'])(
    'stays excluded for %s',
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );
});
