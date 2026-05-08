'use client';

import type { LabelHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '../cn';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor and children are forwarded by the consumer via spread props; the association cannot be statically verified on a generic primitive.
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
);

Label.displayName = 'Label';
