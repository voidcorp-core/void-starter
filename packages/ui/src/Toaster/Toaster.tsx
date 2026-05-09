'use client';

import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

export type ToasterProps = ComponentProps<typeof SonnerToaster>;

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'bg-background text-foreground border-border',
        },
      }}
      {...props}
    />
  );
}
