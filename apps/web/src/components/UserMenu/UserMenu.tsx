'use client';

import { authClient } from '@void/auth';
import { Avatar, Button } from '@void/ui';
import { useEffect, useRef, useState } from 'react';
import { signOutAction } from '@/actions/auth.actions';
import { computeInitials, displayName } from './UserMenu.helper';
import type { UserMenuProps } from './UserMenu.types';

export function UserMenu(_props: UserMenuProps) {
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const user = session?.user;
  if (!user) return null;

  const label = displayName({ name: user.name ?? null, email: user.email });
  const initials = computeInitials(user.name ?? label);

  return (
    <div ref={panelRef} className="relative inline-block">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="rounded-full p-0"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          <Avatar src={user.image ?? null} fallback={initials} size="sm" alt={label} />
        </span>
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-background shadow-md"
        >
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium leading-tight truncate">{label}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>

          <div className="p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={async () => {
                await signOutAction();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
