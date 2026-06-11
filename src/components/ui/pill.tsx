import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Generic tag chip (Sapphire Editorial). For *semantic status* use StatusBadge
 * (spec-locked colors); use Pill for non-status labels like "พักร้อน" / "ฉุกเฉิน".
 */
const variants = {
  pending: 'bg-accent-400/20 text-accent-600',
  approved: 'bg-success-soft text-success-deep',
  leave: 'border border-primary-100 bg-primary-50 text-primary-700',
  neutral: 'bg-gray-100 text-gray-600',
  danger: 'bg-danger-soft text-danger-deep',
} as const;

export function Pill({
  variant = 'neutral',
  children,
  className,
}: {
  variant?: keyof typeof variants;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-[11px] font-semibold',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
