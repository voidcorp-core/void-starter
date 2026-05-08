import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './Button';

describe('Button', () => {
  it('applies the primary variant by default', () => {
    expect(buttonVariants()).toContain('bg-primary');
  });

  it('applies the destructive variant when requested', () => {
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-destructive');
  });

  it('applies size-specific height', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-8');
    expect(buttonVariants({ size: 'lg' })).toContain('h-12');
  });

  it('forwards ref to the underlying button element', () => {
    let captured: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(node) => {
          captured = node;
        }}
      >
        click
      </Button>,
    );
    expect(captured).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole('button').textContent).toBe('click');
  });
});
