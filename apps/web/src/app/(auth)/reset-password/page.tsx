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
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ResetPasswordValues) {
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: '/reset-password/confirm',
    });
    if (error) {
      toast.error(error.message ?? 'Reset failed');
      return;
    }
    toast.success('Check your email for a reset link.');
    form.reset();
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
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
                {form.formState.isSubmitting ? 'Sending...' : 'Send reset link'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
