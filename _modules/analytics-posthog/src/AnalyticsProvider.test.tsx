/**
 * Smoke test for `AnalyticsProvider` gating behaviour.
 *
 * We use `react-dom/server`'s `renderToString` instead of `@testing-library/react`
 * to keep this module's devDeps small. The two assertions we need (children
 * render at all, and `PostHogProvider` wraps them when the key is set) are
 * both verifiable from the rendered HTML string. We mock `posthog-js/react`
 * so the wrapper component renders a deterministic `data-testid` we can grep
 * for, and we mock `posthog-js` so the real SDK never tries to talk to the
 * network during the test.
 */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({
  default: { init: vi.fn() },
}));

vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ph-provider">{children}</div>
  ),
}));

import posthog from 'posthog-js';
import { AnalyticsProvider } from './AnalyticsProvider';

describe('AnalyticsProvider', () => {
  const original = process.env['NEXT_PUBLIC_POSTHOG_KEY'];

  afterEach(() => {
    if (original === undefined) delete process.env['NEXT_PUBLIC_POSTHOG_KEY'];
    else process.env['NEXT_PUBLIC_POSTHOG_KEY'] = original;
    vi.mocked(posthog.init).mockClear();
  });

  it('renders children without PostHogProvider when NEXT_PUBLIC_POSTHOG_KEY is unset', () => {
    delete process.env['NEXT_PUBLIC_POSTHOG_KEY'];

    const html = renderToString(
      <AnalyticsProvider>
        <span data-testid="child">hello</span>
      </AnalyticsProvider>,
    );

    expect(html).toContain('data-testid="child"');
    expect(html).not.toContain('data-testid="ph-provider"');
  });

  it('wraps children in PostHogProvider when NEXT_PUBLIC_POSTHOG_KEY is set', () => {
    process.env['NEXT_PUBLIC_POSTHOG_KEY'] = 'phc_fake_test_key';

    const html = renderToString(
      <AnalyticsProvider>
        <span data-testid="child">hello</span>
      </AnalyticsProvider>,
    );

    expect(html).toContain('data-testid="ph-provider"');
    expect(html).toContain('data-testid="child"');
  });
});
