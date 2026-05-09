/**
 * Thin barrel re-exporting presentation helpers from `@void/auth`.
 *
 * Re-exporting rather than re-implementing keeps the component's internal
 * helpers DRY and ensures the helper logic is tested once at the package
 * level. If the component ever needs additional pure helpers (e.g. a role
 * badge formatter) they can be added here alongside the re-exports.
 */
export { computeInitials, displayName } from '@void/auth';
