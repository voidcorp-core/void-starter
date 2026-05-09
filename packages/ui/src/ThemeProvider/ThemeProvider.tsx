'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider(props: ThemeProviderProps) {
  return <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props} />;
}

export { useTheme } from 'next-themes';
