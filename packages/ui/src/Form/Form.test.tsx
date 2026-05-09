import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Input } from '../Input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './Form';

const schema = z.object({
  email: z.string().email('Email invalide'),
});

type Values = z.infer<typeof schema>;

function Demo({ onSubmit }: { onSubmit?: (values: Values) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => onSubmit?.(values))}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormDescription>Used to sign you in.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

describe('Form composition', () => {
  it('wires aria-describedby and id between FormLabel, FormControl, FormDescription', () => {
    render(<Demo />);
    const input = screen.getByLabelText('Email');
    const description = screen.getByText('Used to sign you in.');
    const id = input.getAttribute('id');
    expect(id).toBeTruthy();
    expect(description.id).toBe(`${id?.replace(/-form-item$/, '')}-form-item-description`);
    expect(input.getAttribute('aria-describedby')).toContain(description.id);
  });

  it('shows error message and sets aria-invalid on validation failure', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Email invalide')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('calls onSubmit with parsed values when valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Demo onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.co' });
  });
});
