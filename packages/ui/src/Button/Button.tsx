'use client';

import { forwardRef } from 'react';
import { cn } from '../cn';
import { getButtonClasses } from './Button.helper';
import type { ButtonProps } from './Button.types';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...props }, ref) => (
    <button ref={ref} className={cn(getButtonClasses(variant, size), className)} {...props}>
      {children}
    </button>
  ),
);

Button.displayName = 'Button';
