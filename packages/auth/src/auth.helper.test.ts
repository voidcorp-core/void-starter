import { describe, expect, it } from 'vitest';
import { computeInitials, displayName } from './auth.helper';

describe('displayName', () => {
  it('returns name when present', () => {
    expect(displayName({ name: 'Alice', email: 'a@b.c' })).toBe('Alice');
  });

  it('falls back to email local part when name is null', () => {
    expect(displayName({ name: null, email: 'alice@example.com' })).toBe('alice');
  });
});

describe('computeInitials', () => {
  it('returns first letter of first and last name parts', () => {
    expect(computeInitials('Alice Bob')).toBe('AB');
  });

  it('returns first 2 letters when single word', () => {
    expect(computeInitials('Alice')).toBe('AL');
  });

  it('returns ?? for empty input', () => {
    expect(computeInitials('')).toBe('??');
  });
});
