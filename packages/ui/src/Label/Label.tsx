'use client';

import type { LabelHTMLAttributes, Ref } from 'react';
import { cn } from '../cn';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  ref?: Ref<HTMLLabelElement>;
};

export function Label({ className, ref, ...props }: LabelProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor and children are forwarded by the consumer via spread props; the association cannot be statically verified on a generic primitive.
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
