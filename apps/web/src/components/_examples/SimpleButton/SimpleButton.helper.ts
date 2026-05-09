import type { SimpleButtonTone } from './SimpleButton.types';

/**
 * Formats a button label for display.
 *
 * - Capitalizes the first character of the label.
 * - Truncates labels longer than 40 characters with an ellipsis.
 * - Returns the label uppercased when tone is 'primary'.
 */
export function formatLabel(label: string, tone: SimpleButtonTone): string {
  const trimmed = label.trim();
  const truncated = trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
  const capitalized = truncated.charAt(0).toUpperCase() + truncated.slice(1);
  return tone === 'primary' ? capitalized.toUpperCase() : capitalized;
}
