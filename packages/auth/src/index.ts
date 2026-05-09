export { authClient } from './auth.client';
export {
  EmailAlreadyTakenError,
  InvalidCredentialsError,
  MagicLinkExpiredError,
} from './auth.errors';
export { computeInitials, displayName } from './auth.helper';
export { canAccessAdminPanel } from './auth.policy';
export {
  getCurrentUser,
  requireAuth,
  requireRole,
  signIn,
  signOut,
} from './auth.service';
export {
  type AuthSession,
  type Role,
  roleSchema,
  type SessionUser,
  sessionUserSchema,
} from './auth.types';
export {
  type ActionState,
  defineAction,
  defineFormAction,
  initialActionState,
} from './auth-action';
