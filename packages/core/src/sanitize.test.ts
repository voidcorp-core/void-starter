import { describe, expect, it } from 'vitest';
import { maskEmail, truncate } from './sanitize';

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
