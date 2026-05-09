import { describe, expect, it } from 'vitest';
import { formatLabel } from './SimpleButton.helper';

describe('formatLabel', () => {
  it('capitalizes the first character', () => {
    expect(formatLabel('click me', 'ghost')).toBe('Click me');
  });

  it('uppercases the full label when tone is primary', () => {
    expect(formatLabel('click me', 'primary')).toBe('CLICK ME');
  });

  it('truncates labels longer than 40 characters', () => {
    const long = 'This label is way too long to fit in a button element';
    const result = formatLabel(long, 'ghost');
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates and uppercases for primary tone with long label', () => {
    const long = 'This label is way too long to fit in a button element';
    const result = formatLabel(long, 'primary');
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toBe(result.toUpperCase());
  });

  it('trims leading and trailing whitespace before processing', () => {
    expect(formatLabel('  hello  ', 'ghost')).toBe('Hello');
  });

  it('handles an already-capitalized label without doubling', () => {
    expect(formatLabel('Submit', 'ghost')).toBe('Submit');
  });

  it('returns the label unchanged for ghost when already short and capitalized', () => {
    expect(formatLabel('Go', 'ghost')).toBe('Go');
  });
});
