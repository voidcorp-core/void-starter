import { describe, expect, it } from 'vitest';
import { defaultSecurityHeaders } from './security-headers';

describe('defaultSecurityHeaders', () => {
  it('returns an array of header definitions for next.config headers()', () => {
    const headers = defaultSecurityHeaders();
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(0);
  });

  it('includes HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, Referrer-Policy', () => {
    const headers = defaultSecurityHeaders();
    const keys = headers.map((h) => h.key);
    expect(keys).toContain('Strict-Transport-Security');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Permissions-Policy');
    expect(keys).toContain('Referrer-Policy');
  });

  it('uses DENY for X-Frame-Options', () => {
    const headers = defaultSecurityHeaders();
    const xfo = headers.find((h) => h.key === 'X-Frame-Options');
    expect(xfo?.value).toBe('DENY');
  });
});
