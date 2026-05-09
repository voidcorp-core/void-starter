import { describe, expect, it } from 'vitest';
import { computeInitials, displayName } from './UserMenu.helper';

describe('UserMenu helpers (re-exports from @void/auth)', () => {
  it('displayName returns a string', () => {
    expect(typeof displayName({ name: 'Alice', email: 'a@b.com' })).toBe('string');
  });

  it('computeInitials returns a string', () => {
    expect(typeof computeInitials('Alice Bob')).toBe('string');
  });
});
