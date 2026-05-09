import { Button } from '@void/ui';
import Link from 'next/link';
import { formatLabel } from './SimpleButton.helper';
import type { SimpleButtonProps } from './SimpleButton.types';

/**
 * SimpleButton — canonical 5-file presentational component example.
 *
 * A thin server-friendly wrapper around @void/ui's Button. Demonstrates:
 * - Pure helper extraction (formatLabel)
 * - Type isolation in .types.ts
 * - asChild pattern for link rendering
 * - No 'use client' required: Button is already client-marked; importing it
 *   from a Server Component is valid in React/Next.js.
 */
export function SimpleButton({ label, tone = 'primary', href }: SimpleButtonProps) {
  const formatted = formatLabel(label, tone);
  const variant = tone === 'primary' ? 'primary' : 'ghost';

  if (href) {
    return (
      <Button variant={variant} asChild>
        <Link href={href}>{formatted}</Link>
      </Button>
    );
  }

  return <Button variant={variant}>{formatted}</Button>;
}
