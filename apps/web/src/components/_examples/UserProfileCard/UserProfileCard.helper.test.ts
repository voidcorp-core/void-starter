import { describe, expect, it } from 'vitest';
import { computeStatus, formatJoinDate, validateNameInput } from './UserProfileCard.helper';

describe('formatJoinDate', () => {
  it('formats a date as month + year', () => {
    expect(formatJoinDate(new Date('2026-05-01T00:00:00Z'))).toMatch(/May 2026/);
  });

  it('formats January correctly', () => {
    expect(formatJoinDate(new Date('2024-01-15T00:00:00Z'))).toMatch(/January 2024/);
  });

  it('returns a non-empty string for any valid date', () => {
    const result = formatJoinDate(new Date('2020-12-31T00:00:00Z'));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('computeStatus', () => {
  it('returns disabled when deletedAt is set', () => {
    expect(computeStatus({ deletedAt: new Date(), role: 'user' })).toBe('disabled');
  });

  it('returns disabled even when role is admin if soft-deleted', () => {
    expect(computeStatus({ deletedAt: new Date(), role: 'admin' })).toBe('disabled');
  });

  it('returns admin when role is admin and not deleted', () => {
    expect(computeStatus({ deletedAt: null, role: 'admin' })).toBe('admin');
  });

  it('returns active for a normal user', () => {
    expect(computeStatus({ deletedAt: null, role: 'user' })).toBe('active');
  });

  it('returns active for unknown roles (non-admin, non-deleted)', () => {
    expect(computeStatus({ deletedAt: null, role: 'moderator' })).toBe('active');
  });
});

describe('validateNameInput', () => {
  it('returns ok with trimmed value for a valid name', () => {
    const result = validateNameInput('Alice');
    expect(result).toEqual({ ok: true, value: 'Alice' });
  });

  it('trims whitespace before validating', () => {
    const result = validateNameInput('  Bob  ');
    expect(result).toEqual({ ok: true, value: 'Bob' });
  });

  it('returns ok: false for an empty string', () => {
    const result = validateNameInput('');
    expect(result.ok).toBe(false);
  });

  it('returns ok: false for a whitespace-only string', () => {
    const result = validateNameInput('   ');
    expect(result.ok).toBe(false);
  });

  it('returns ok: false for a name exceeding 100 characters', () => {
    const long = 'a'.repeat(101);
    const result = validateNameInput(long);
    expect(result.ok).toBe(false);
  });

  it('returns ok: true for exactly 100 characters', () => {
    const exactly = 'a'.repeat(100);
    const result = validateNameInput(exactly);
    expect(result).toEqual({ ok: true, value: exactly });
  });
});
