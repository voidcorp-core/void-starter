'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../cn';

export const spinnerVariants = cva('animate-spin', {
  variants: {
    size: {
      sm: 'h-4 w-4',
      md: 'h-5 w-5',
      lg: 'h-6 w-6',
      xl: 'h-8 w-8',
    },
  },
  defaultVariants: { size: 'md' },
});

type Loader2Props = ComponentProps<typeof Loader2>;

export type SpinnerProps = Omit<Loader2Props, 'size'> &
  VariantProps<typeof spinnerVariants> & {
    label?: string;
  };

export function Spinner({ size, className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  );
}
