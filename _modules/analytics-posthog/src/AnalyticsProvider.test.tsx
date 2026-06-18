/**
 * Smoke test for `AnalyticsProvider` render behaviour.
 *
 * Uses `react-dom/server`'s `renderToString` to avoid pulling
 * `@testing-library/react` into this module's devDeps. Effects do not run
 * under SSR, which is exactly right here: the PostHog SDK init is an
 * effect-only side effect (a dynamic `import('posthog-js')` gated on the key,
 * see ADR 32), and what this test pins is the RENDER contract -- the provider
 * passes children through unchanged and never injects a wrapper element,
 * whether or not the key is set. The dynamic-import gate itself is verified by
 * the build (README "Zero-bundle note").
 */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyticsProvider } from './AnalyticsProvider';

const CHILD = '<span data-testid="child">hello</span>';

describe('AnalyticsProvider', () => {
  const original = process.env['NEXT_PUBLIC_POSTHOG_KEY'];

  afterEach(() => {
    if (original === undefined) delete process.env['NEXT_PUBLIC_POSTHOG_KEY'];
    else process.env['NEXT_PUBLIC_POSTHOG_KEY'] = original;
  });

  it('renders children unchanged when the key is unset', () => {
    delete process.env['NEXT_PUBLIC_POSTHOG_KEY'];

    const html = renderToString(
      <AnalyticsProvider>
        <span data-testid="child">hello</span>
      </AnalyticsProvider>,
    );

    expect(html).toBe(CHILD);
  });

  it('renders children unchanged (no wrapper element) when the key is set', () => {
    process.env['NEXT_PUBLIC_POSTHOG_KEY'] = 'phc_fake_test_key';

    const html = renderToString(
      <AnalyticsProvider>
        <span data-testid="child">hello</span>
      </AnalyticsProvider>,
    );

    expect(html).toBe(CHILD);
  });
});
