import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'approve' | 'reject';
type Size = 'sm' | 'md' | 'lg';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-primary-600 text-white shadow-sm hover:bg-primary-700 focus-visible:ring-primary-500/50',
  secondary:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-primary-500/30',
  destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500/50',
  ghost: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-primary-500/30',
  // Approve = positive/confirming action (green gradient CTA, per mockups).
  approve:
    'bg-gradient-to-b from-success to-success-deep text-white shadow-cta hover:brightness-105 focus-visible:ring-success/40',
  // Reject = neutral-bordered (the dangerous part is confirmed in the dialog).
  reject:
    'border border-gray-300 bg-white text-ink-2 hover:bg-gray-50 focus-visible:ring-primary-500/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    />
  );
}
