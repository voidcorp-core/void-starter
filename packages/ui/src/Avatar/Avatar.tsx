'use client';

import * as RadixAvatar from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, Ref } from 'react';
import { cn } from '../cn';

export const avatarVariants = cva(
  'relative inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium overflow-hidden',
  {
    variants: {
      size: {
        sm: 'h-8 w-8 text-xs',
        md: 'h-10 w-10 text-sm',
        lg: 'h-12 w-12 text-base',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

type AvatarRootProps = ComponentProps<typeof RadixAvatar.Root>;

export type AvatarProps = Omit<AvatarRootProps, 'children'> &
  VariantProps<typeof avatarVariants> & {
    src?: string | null;
    alt?: string;
    fallback: string;
    ref?: Ref<HTMLSpanElement>;
  };

export function Avatar({ src, alt = '', fallback, size, className, ref, ...props }: AvatarProps) {
  return (
    <RadixAvatar.Root ref={ref} className={cn(avatarVariants({ size }), className)} {...props}>
      {src ? (
        <RadixAvatar.Image src={src} alt={alt} className="h-full w-full object-cover" />
      ) : null}
      <RadixAvatar.Fallback className="inline-flex h-full w-full items-center justify-center">
        {fallback}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
