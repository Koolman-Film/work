import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Canonical status colors — single source of truth for every status pill
 * across the app (per docs/v1/screens/shared-patterns.md:486-515).
 *
 * Hex pairs (bg/fg) are copied verbatim from the spec. Adding a new
 * status? Add the row here, not inline at the call site.
 */
const STATUS_COLORS = {
  // Approval states
  pending: 'bg-[#fef3c7] text-[#92400e]',
  approved: 'bg-[#d1fae5] text-[#065f46]',
  rejected: 'bg-[#fee2e2] text-[#991b1b]',
  cancelled: 'bg-[#e2e8f0] text-[#475569]',

  // Leave types
  sick: 'bg-[#dbeafe] text-[#1e40af]',
  personal: 'bg-[#ede9fe] text-[#6b21a8]',
  vacation: 'bg-[#d1fae5] text-[#065f46]',
  maternity: 'bg-[#fce7f3] text-[#9d174d]',

  // Attendance
  late: 'bg-[#fed7aa] text-[#9a3412]',
  absent: 'bg-[#fee2e2] text-[#991b1b]',
  noscan: 'bg-[#e2e8f0] text-[#475569]',

  // Payroll
  draft: 'bg-[#fef3c7] text-[#92400e]',
  reviewed: 'bg-[#d1fae5] text-[#065f46]',
  published: 'bg-[#d1fae5] text-[#065f46]',
  override: 'bg-[#fed7aa] text-[#9a3412]',
  locked: 'bg-[#dbeafe] text-[#1e40af]',

  // Employment status (extends spec for our enums)
  probation: 'bg-[#fef3c7] text-[#92400e]',
  active: 'bg-[#d1fae5] text-[#065f46]',
  archived: 'bg-[#e2e8f0] text-[#475569]',

  // Generic neutral
  neutral: 'bg-gray-100 text-gray-700',
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

type Props = {
  /** The semantic state — drives color. */
  status: StatusKey;
  /** The text shown to the user (usually Thai). */
  children: ReactNode;
  className?: string;
};

export function StatusBadge({ status, children, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_COLORS[status],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Left-rail border color per approval status (width comes from `border-l-4`). */
export const STATUS_RAIL: Partial<Record<StatusKey, string>> = {
  pending: 'border-l-amber-400',
  approved: 'border-l-emerald-400',
  rejected: 'border-l-red-400',
  cancelled: 'border-l-slate-300',
};

/** Small glyph shown inside the badge for approval statuses. */
export const STATUS_ICON: Partial<Record<StatusKey, string>> = {
  pending: '⏳',
  approved: '✓',
  rejected: '✕',
  cancelled: '⊘',
};

/** Rail class for a row, with a neutral fallback for non-approval keys. */
export function statusRail(status: StatusKey): string {
  return STATUS_RAIL[status] ?? 'border-l-gray-200';
}
