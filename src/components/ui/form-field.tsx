import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Form-field wrapper — label + control + help text + error.
 *
 * Usage:
 *   <FormField label="ชื่อสาขา" htmlFor="name" error={errors?.name} required>
 *     <Input id="name" name="name" />
 *   </FormField>
 *
 * The error block uses `role="alert"` so screen readers announce it
 * the moment it appears (e.g., after Server Action redirect with ?error=).
 */

type Props = {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
};

export function FormField({ label, htmlFor, children, hint, error, required, className }: Props) {
  const hasError = Boolean(error);
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hasError ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
