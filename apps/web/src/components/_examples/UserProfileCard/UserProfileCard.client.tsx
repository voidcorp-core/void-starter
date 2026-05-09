'use client';

import type { ActionState } from '@void/auth';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@void/ui';
import type React from 'react';
import { useActionState, useOptimistic } from 'react';
import { updateProfileAction } from './UserProfileCard.actions';
import { computeStatus, formatJoinDate, validateNameInput } from './UserProfileCard.helper';
import type { UserProfileCardProps } from './UserProfileCard.types';

type UpdateResult = { name: string };

/**
 * UserProfileCardClient -- interactive form inside the card.
 *
 * Uses React 19's `useActionState` + `useOptimistic` for the progressive-
 * enhancement update pattern:
 *  - `useActionState` binds the Server Action and tracks form submission state.
 *  - `useOptimistic` renders the new name immediately on submit, before the
 *    round-trip completes, providing instant UI feedback.
 *
 * Not exported from the barrel (index.ts). Consumers use the default-export
 * `UserProfileCard` Server Component instead, which handles the session read
 * and passes the user as a prop here.
 */
export function UserProfileCardClient({ user }: UserProfileCardProps) {
  const initialState: ActionState<UpdateResult> = { ok: false, fieldErrors: {} };

  const [state, formAction, isPending] = useActionState(updateProfileAction, initialState);

  const [optimisticName, applyOptimistic] = useOptimistic(
    user.name ?? '',
    (_current: string, next: string) => next,
  );

  const status = computeStatus({ deletedAt: null, role: user.role });
  const joinDate = formatJoinDate(new Date());

  const statusLabel: Record<typeof status, string> = {
    active: 'Active',
    admin: 'Admin',
    disabled: 'Disabled',
  };

  const statusClass: Record<typeof status, string> = {
    active: 'bg-green-100 text-green-800',
    admin: 'bg-blue-100 text-blue-800',
    disabled: 'bg-gray-100 text-gray-500',
  };

  const fieldErrors = !state.ok ? (state.fieldErrors?.['name'] ?? []) : [];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const nameInput = (form.elements.namedItem('name') as HTMLInputElement).value;
    const validation = validateNameInput(nameInput);
    if (!validation.ok) {
      event.preventDefault();
      return;
    }
    applyOptimistic(validation.value);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Profile</CardTitle>
          <span
            className={['rounded-full px-2.5 py-0.5 text-xs font-medium', statusClass[status]].join(
              ' ',
            )}
          >
            {statusLabel[status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Member since {joinDate}</p>
      </CardHeader>

      <CardContent>
        <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={optimisticName}
              invalid={fieldErrors.length > 0}
              placeholder="Your name"
              disabled={isPending}
            />
            {fieldErrors.length > 0 && <p className="text-sm text-destructive">{fieldErrors[0]}</p>}
            {!state.ok && state.formError && (
              <p className="text-sm text-destructive">{state.formError.message}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
            {state.ok && (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Saved
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
