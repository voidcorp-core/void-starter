import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export const skeletonVariants = cva('animate-pulse bg-muted', {
  variants: {
    radius: {
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      full: 'rounded-full',
      none: 'rounded-none',
    },
  },
  defaultVariants: { radius: 'md' },
});

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof skeletonVariants>;

export function Skeleton({ className, radius, ...props }: SkeletonProps) {
  return <div className={cn(skeletonVariants({ radius }), className)} {...props} />;
}
