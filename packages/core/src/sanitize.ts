export function maskEmail(input: string): string {
  const at = input.indexOf('@');
  if (at <= 0) return input;
  const local = input.slice(0, at);
  const domain = input.slice(at);
  if (local.length === 1) return `*${domain}`;
  if (local.length === 2) return `${local.charAt(0)}*${domain}`;
  return `${local.charAt(0)}${'*'.repeat(local.length - 2)}${local.charAt(local.length - 1)}${domain}`;
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...`;
}

/**
 * Coerce an untrusted redirect target to a safe SAME-ORIGIN path, preventing
 * open-redirect (e.g. a `?callbackURL=https://evil.com` query param flowing
 * into `router.push` / Better-Auth's `callbackURL`). Returns `fallback` unless
 * `raw` is a clean internal path: starts with a single `/`, is not `//`
 * (protocol-relative), and carries no scheme or backslash. Callers reading
 * from `URLSearchParams.get()` / `Headers.get()` should pass `value ?? undefined`.
 */
export function safeInternalPath(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.includes('://') || raw.includes('\\')) return fallback;
  return raw;
}
