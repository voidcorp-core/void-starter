import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest runs with `globals: false`, so @testing-library/react can't
// auto-register its own afterEach(cleanup). Wire it explicitly so the JSDOM
// document is reset between tests; without this, repeated `render()` calls in
// the same file accumulate into the body and break role/label queries.
afterEach(() => {
  cleanup();
});
