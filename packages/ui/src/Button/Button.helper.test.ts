import { describe, expect, it } from 'vitest';
import { getButtonClasses } from './Button.helper';

describe('getButtonClasses', () => {
  it('returns base classes for default variant + size', () => {
    expect(getButtonClasses('primary', 'md')).toContain('bg-primary');
  });

  it('applies destructive variant styles', () => {
    expect(getButtonClasses('destructive', 'md')).toContain('bg-destructive');
  });

  it('applies size-specific padding', () => {
    expect(getButtonClasses('primary', 'sm')).toContain('h-8');
    expect(getButtonClasses('primary', 'lg')).toContain('h-12');
  });
});
