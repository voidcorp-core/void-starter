'use client';

import { Slot } from '@radix-ui/react-slot';
import { type ComponentProps, createContext, type Ref, useContext, useId } from 'react';
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from 'react-hook-form';
import { cn } from '../cn';
import { Label } from '../Label';

// Re-export the RHF top-level provider as <Form> for ergonomic alignment
// with shadcn/ui v3. Consumers wrap their <form> with <Form {...form}> where
// `form = useForm({ resolver: zodResolver(schema), defaultValues })`.
export const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

type FormItemContextValue = {
  id: string;
};

const FormItemContext = createContext<FormItemContextValue | null>(null);

export function useFormField() {
  const fieldContext = useContext(FormFieldContext);
  const itemContext = useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext?.name as string });

  if (!fieldContext) {
    throw new Error('useFormField must be used inside <FormField>');
  }
  if (!itemContext) {
    throw new Error('useFormField must be used inside <FormItem>');
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

export type FormItemProps = ComponentProps<'div'> & { ref?: Ref<HTMLDivElement> };

export function FormItem({ className, ref, ...props }: FormItemProps) {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn('flex flex-col gap-2', className)} {...props} />
    </FormItemContext.Provider>
  );
}

export type FormLabelProps = ComponentProps<typeof Label>;

export function FormLabel({ className, ...props }: FormLabelProps) {
  const { error, formItemId } = useFormField();
  return (
    <Label
      data-error={Boolean(error)}
      htmlFor={formItemId}
      className={cn('data-[error=true]:text-destructive', className)}
      {...props}
    />
  );
}

export type FormControlProps = ComponentProps<typeof Slot>;

export function FormControl(props: FormControlProps) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : `${formDescriptionId}`}
      aria-invalid={Boolean(error) || undefined}
      {...props}
    />
  );
}

export type FormDescriptionProps = ComponentProps<'p'> & { ref?: Ref<HTMLParagraphElement> };

export function FormDescription({ className, ref, ...props }: FormDescriptionProps) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export type FormMessageProps = ComponentProps<'p'> & { ref?: Ref<HTMLParagraphElement> };

export function FormMessage({ className, children, ref, ...props }: FormMessageProps) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? '') : children;
  if (!body) return null;
  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-sm text-destructive font-medium', className)}
      {...props}
    >
      {body}
    </p>
  );
}
