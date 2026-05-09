'use client';

import { authClient } from '@void/auth';
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@void/ui';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

interface VerifyEmailClientProps {
  token: string;
}

export function VerifyEmailClient({ token }: VerifyEmailClientProps) {
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    authClient.verifyEmail({ query: { token } }).then(({ error }) => {
      if (error) {
        toast.error(error.message ?? 'Verification failed');
      } else {
        toast.success('Email verified.');
      }
    });
  }, [token]);

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Verifying your email…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Please wait while we verify your email address.
          </p>
          <Button asChild className="w-full">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
