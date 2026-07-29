/**
 * The single origin the E2E run talks to.
 *
 * Shared by `playwright.config.ts` and the helpers rather than repeated, because
 * requests to Better Auth must carry it as an `Origin` header: the value has to
 * be the same string the server was reached on, or the request is refused as
 * cross-origin.
 */
export const BASE_URL = 'http://localhost:3000';
