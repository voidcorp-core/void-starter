'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { authClient } from '@void/auth';
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
} from '@void/ui';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const magicLinkSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

type MagicLinkValues = z.infer<typeof magicLinkSchema>;

export default function MagicLinkPage() {
  const form = useForm<MagicLinkValues>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: MagicLinkValues) {
    const { error } = await authClient.signIn.magicLink({
      email: values.email,
      callbackURL: '/dashboard',
    });
    if (error) {
      toast.error(error.message ?? 'Magic link failed');
      return;
    }
    toast.success('Check your email for the sign-in link.');
    form.reset();
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in with magic link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                {form.formState.isSubmitting ? 'Sending...' : 'Send magic link'}
              </Button>
            </form>
          </Form>
          <p className="text-center text-sm text-muted-foreground">
            Prefer a password?{' '}
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
