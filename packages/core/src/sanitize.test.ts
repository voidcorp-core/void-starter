import { describe, expect, it } from 'vitest';
import { maskEmail, safeInternalPath, truncate } from './sanitize';

describe('safeInternalPath', () => {
  it('returns a clean internal path unchanged', () => {
    expect(safeInternalPath('/dashboard', '/home')).toBe('/dashboard');
    expect(safeInternalPath('/notes?tag=x', '/home')).toBe('/notes?tag=x');
  });

  it('falls back when empty or undefined', () => {
    expect(safeInternalPath(undefined, '/home')).toBe('/home');
    expect(safeInternalPath('', '/home')).toBe('/home');
  });

  it('rejects protocol-relative and absolute URLs (open-redirect guard)', () => {
    expect(safeInternalPath('//evil.com', '/home')).toBe('/home');
    expect(safeInternalPath('https://evil.com', '/home')).toBe('/home');
    expect(safeInternalPath('http://evil.com', '/home')).toBe('/home');
    expect(safeInternalPath('javascript:alert(1)', '/home')).toBe('/home');
  });

  it('rejects paths that do not start with a single slash', () => {
    expect(safeInternalPath('dashboard', '/home')).toBe('/home');
    expect(safeInternalPath('\\\\evil.com', '/home')).toBe('/home');
  });
});

describe('maskEmail', () => {
  it('masks the local part keeping first and last char', () => {
    expect(maskEmail('alice@example.com')).toBe('a***e@example.com');
  });

  it('handles short local parts', () => {
    expect(maskEmail('ab@example.com')).toBe('a*@example.com');
    expect(maskEmail('a@example.com')).toBe('*@example.com');
  });

  it('returns the input unchanged when not an email', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('truncate', () => {
  it('truncates strings longer than max with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('returns the original string when shorter or equal', () => {
    expect(truncate('hi', 10)).toBe('hi');
    expect(truncate('hi', 2)).toBe('hi');
  });
});
