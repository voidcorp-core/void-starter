'use client';

import { Button } from '@void/ui';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Future: forward to @void/sentry when installed (Phase D module).
    // pino is server-only (ADR 22), so the browser-side error path stays on
    // console.error until the Sentry module is wired.
    // biome-ignore lint/suspicious/noConsole: documented Sentry placeholder; see comment above
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center space-y-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
