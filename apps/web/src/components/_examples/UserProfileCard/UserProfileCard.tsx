/**
 * UserProfileCard — Server Component entry point.
 *
 * Reads the current session server-side via `getCurrentUser()`, then delegates
 * all interactive rendering to `UserProfileCardClient`. This split is the
 * canonical void-starter pattern for authenticated server-to-client handoff:
 *  - Auth and initial data stay on the server (no client-side fetch waterfall).
 *  - Only the interactive leaf component carries 'use client'.
 *
 * FILE LAYOUT NOTE: Next.js requires `'use client'` at the top of a module
 * boundary, so the interactive portion lives in UserProfileCard.client.tsx and
 * is imported here. The outer async Server Component and the inner Client
 * Component are co-located in the same directory; the barrel (index.ts) exposes
 * only the server default export and its prop types — the client component is
 * an implementation detail.
 */
import { getCurrentUser } from '@void/auth';
import { UserProfileCardClient } from './UserProfileCard.client';

export { UserProfileCardClient };

export default async function UserProfileCard() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <UserProfileCardClient user={user} />;
}
