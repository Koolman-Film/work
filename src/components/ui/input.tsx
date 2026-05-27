import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const inputClasses = cn(
  'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm',
  'placeholder:text-gray-400',
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
  'aria-[invalid="true"]:border-red-500 aria-[invalid="true"]:focus:ring-red-500/30',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(inputClasses, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(inputClasses, className)} {...rest} />;
});
