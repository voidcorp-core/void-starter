/**
 * Types for the SimpleButton component.
 */

export type SimpleButtonTone = 'primary' | 'ghost';

export type SimpleButtonProps = {
  label: string;
  tone?: SimpleButtonTone;
  href?: string;
};
