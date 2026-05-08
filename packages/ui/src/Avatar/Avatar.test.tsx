import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Avatar, avatarVariants } from './Avatar';

describe('Avatar', () => {
  it('applies the md size by default', () => {
    expect(avatarVariants()).toContain('h-10');
  });

  it('applies size-specific dimensions', () => {
    expect(avatarVariants({ size: 'sm' })).toContain('h-8');
    expect(avatarVariants({ size: 'lg' })).toContain('h-12');
  });

  it('renders fallback text when no src is provided', () => {
    render(<Avatar fallback="FP" />);
    expect(screen.getByText('FP')).toBeDefined();
  });

  describe('with a successfully loaded src', () => {
    const RealImage = window.Image;

    beforeEach(() => {
      // Stub window.Image so Radix Avatar.Image flips to "loaded" synchronously.
      class ImmediateImage {
        src = '';
        naturalWidth = 100;
        complete = true;
        addEventListener(event: string, handler: () => void) {
          if (event === 'load') queueMicrotask(handler);
        }
        removeEventListener() {}
        referrerPolicy = '';
        crossOrigin: string | null = null;
      }
      // @ts-expect-error - test override of the global constructor
      window.Image = ImmediateImage;
    });

    afterEach(() => {
      window.Image = RealImage;
    });

    it('renders the image when src is provided', async () => {
      render(<Avatar src="https://example.com/avatar.png" alt="Folpe" fallback="FP" />);
      const img = await screen.findByRole('img');
      expect(img).toBeInstanceOf(HTMLImageElement);
      expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
      expect(img.getAttribute('alt')).toBe('Folpe');
    });
  });

  it('forwards ref to the underlying root span element', () => {
    let captured: HTMLSpanElement | null = null;
    render(
      <Avatar
        fallback="FP"
        ref={(node) => {
          captured = node;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLSpanElement);
  });
});
