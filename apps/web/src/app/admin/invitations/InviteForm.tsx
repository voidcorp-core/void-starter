'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@repo/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { issueInvitationAction } from '@/actions/invitations.actions';

/**
 * Issues an invitation and shows the resulting token exactly once (ADR 63).
 *
 * The token is displayed rather than only mailed because the administrator is
 * the one who decides how the invitee receives it, and because only its digest
 * is stored: once this component loses the value, nobody can recover it. That
 * is deliberate, not an oversight -- a recoverable invitation link would mean a
 * database leak hands over usable credentials.
 */

const inviteSchema = z.object({
  email: z.email('Enter a valid email'),
});

type InviteValues = z.infer<typeof inviteSchema>;

type Issued = {
  email: string;
  token: string;
  expiresAt: string;
};

export function InviteForm() {
  const [issued, setIssued] = useState<Issued | undefined>(undefined);
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: InviteValues) {
    try {
      const result = await issueInvitationAction({ email: values.email });
      setIssued(result);
      form.reset();
      toast.success(`Invitation issued for ${result.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not issue the invitation');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite an address</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-end gap-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="teammate@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Inviting...' : 'Invite'}
            </Button>
          </form>
        </Form>

        {issued ? (
          <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              Invitation token for {issued.email}, shown once and not recoverable:
            </p>
            <code className="block break-all">{issued.token}</code>
            <p className="text-muted-foreground">
              Expires {new Date(issued.expiresAt).toLocaleString()}.
            </p>
          </div>
        ) : undefined}
      </CardContent>
    </Card>
  );
}
