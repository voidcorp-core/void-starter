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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // Close on Escape and return focus to trigger
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const user = session?.user;
  if (!user) return null;

  const label = displayName({ name: user.name ?? null, email: user.email });
  const initials = computeInitials(user.name ?? label);

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="rounded-full p-0"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span ref={triggerRef}>
          <Avatar src={user.image ?? null} fallback={initials} size="sm" alt={label} />
        </span>
      </Button>

      <div
        id="user-menu-panel"
        role="menu"
        data-state={open ? 'open' : 'closed'}
        className={[
          'absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-background shadow-md',
          'transition-all duration-150 ease-out',
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none',
        ].join(' ')}
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-medium leading-tight truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>

        <div className="p-1">
          <Button
            role="menuitem"
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
    </div>
  );
}
