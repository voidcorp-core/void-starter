import { describe, expect, it } from 'vitest';
import { computeInitials, displayName } from './UserMenu.helper';

describe('UserMenu helpers (re-exports from @void/auth)', () => {
  describe('displayName', () => {
    it('returns name when set', () => {
      expect(displayName({ name: 'Alice Bob', email: 'alice@example.com' })).toBe('Alice Bob');
    });

    it('returns email local part when name is null', () => {
      expect(displayName({ name: null, email: 'alice@example.com' })).toBe('alice');
    });

    it('returns full email when there is no @ sign', () => {
      expect(displayName({ name: null, email: 'nodomain' })).toBe('nodomain');
    });
  });

  describe('computeInitials', () => {
    it('returns first letters of first and last word for multi-word names', () => {
      expect(computeInitials('Alice Bob')).toBe('AB');
    });

    it('returns first two letters uppercased for single-word name', () => {
      expect(computeInitials('Alice')).toBe('AL');
    });

    it('returns ?? for empty string', () => {
      expect(computeInitials('')).toBe('??');
    });

    it('collapses extra whitespace before splitting', () => {
      expect(computeInitials('  Alice   Bob  ')).toBe('AB');
    });
  });
});
