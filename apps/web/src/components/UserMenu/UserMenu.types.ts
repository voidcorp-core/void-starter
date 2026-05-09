/**
 * Types for the UserMenu component.
 *
 * `UserMenuProps` is intentionally empty: the component sources its data
 * from `useSession()` rather than through props.
 *
 * `UserDisplayInput` mirrors the input shape expected by `displayName` and
 * `computeInitials` from `@void/auth`, kept local here so callers of the
 * helper file do not need to import auth types directly.
 */

export type UserMenuProps = Record<string, never>;

export type UserDisplayInput = {
  name: string | null;
  email: string;
};
