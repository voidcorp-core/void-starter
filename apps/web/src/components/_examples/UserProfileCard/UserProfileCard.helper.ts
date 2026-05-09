/**
 * Pure formatting and validation helpers for UserProfileCard.
 *
 * These helpers do not import React or any server-side module, so they can be
 * unit-tested without rendering and reused in both the server and client parts
 * of the component.
 */

/**
 * Formats a createdAt date as a human-readable month + year string.
 * Example: new Date('2026-05-01') -> 'May 2026'
 */
export function formatJoinDate(createdAt: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(createdAt);
}

/**
 * Derives a display status from the user's soft-delete flag and role.
 * - 'disabled' when deletedAt is set (soft-deleted).
 * - 'admin'    when role is 'admin'.
 * - 'active'   otherwise.
 */
export function computeStatus(user: {
  deletedAt: Date | null;
  role: string;
}): 'active' | 'admin' | 'disabled' {
  if (user.deletedAt !== null) return 'disabled';
  if (user.role === 'admin') return 'admin';
  return 'active';
}

/**
 * Pre-flight client-side name validation.
 *
 * NOT a replacement for the Zod server schema in UserProfileCard.actions.ts.
 * Used only for immediate UX feedback before the form submits.
 */
export function validateNameInput(
  input: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Name is required.' };
  }
  if (trimmed.length > 100) {
    return { ok: false, reason: 'Name must be 100 characters or fewer.' };
  }
  return { ok: true, value: trimmed };
}
