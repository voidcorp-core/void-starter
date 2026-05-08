export const tokens = {
  colors: {
    background: 'var(--color-background)',
    foreground: 'var(--color-foreground)',
    muted: 'var(--color-muted)',
    mutedForeground: 'var(--color-muted-foreground)',
    primary: 'var(--color-primary)',
    primaryForeground: 'var(--color-primary-foreground)',
    destructive: 'var(--color-destructive)',
    destructiveForeground: 'var(--color-destructive-foreground)',
    border: 'var(--color-border)',
    ring: 'var(--color-ring)',
  },
  radius: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
  },
} as const;

export type DesignTokens = typeof tokens;
