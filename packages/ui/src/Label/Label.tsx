'use client';

import * as RadixLabel from '@radix-ui/react-label';
import type { ComponentProps, Ref } from 'react';
import { cn } from '../cn';

export type LabelProps = ComponentProps<typeof RadixLabel.Root> & {
  ref?: Ref<HTMLLabelElement>;
};

export function Label({ className, ref, ...props }: LabelProps) {
  return (
    <RadixLabel.Root
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
