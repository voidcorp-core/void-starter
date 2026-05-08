/**
 * Pure presentation helpers for `@void/auth`.
 *
 * Stateless, synchronous functions used by UI surfaces (avatars, headers,
 * mention chips, etc.) to derive display strings from a `SessionUser` or
 * raw inputs. Kept free of any IO, framework, or session lookup so they
 * can run in any context (server, client, edge, tests) and remain trivial
 * to unit test.
 *
 * Add new helpers here when they are pure and presentation-oriented.
 * Anything that needs the current session belongs in `auth.service.ts`;
 * anything that needs `instanceof` checks against `AppError` subclasses
 * belongs in `auth.errors.ts`.
 */

/**
 * Returns the best human-readable label for a user. Prefers an explicit
 * `name` when set, otherwise falls back to the email local part (the
 * substring before `@`). When no `@` is present, the full email is
 * returned as a last resort so the function never returns an empty
 * string for a non-empty input.
 */
export function displayName(input: { name: string | null; email: string }): string {
  if (input.name) return input.name;
  const at = input.email.indexOf('@');
  return at > 0 ? input.email.slice(0, at) : input.email;
}

/**
 * Computes a 2-character initials string for an avatar fallback.
 *
 *   - Multi-word input: first letter of the first and last words ('Alice Bob' -> 'AB').
 *   - Single-word input: first two letters of the word ('Alice' -> 'AL').
 *   - Empty/whitespace-only input: the literal '??', which renders as a
 *     neutral placeholder rather than an empty avatar bubble.
 *
 * Always uppercase. Whitespace is collapsed before splitting, so inputs
 * with extra spaces ('  Alice   Bob  ') still produce 'AB'.
 */
export function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]?.charAt(0) ?? '';
    const last = parts[parts.length - 1]?.charAt(0) ?? '';
    return `${first}${last}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
