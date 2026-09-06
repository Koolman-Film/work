import { Pencil } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The action at the end of a table row.
 *
 * Previously a bare coloured link. Repeated down a column that reads as a
 * stripe of blue prose with no target boundary — you cannot tell where the hit
 * area starts, and it does not look like the buttons everywhere else in the
 * app.
 *
 * Icon + label in an outlined button: a real boundary, neutral rather than
 * blue so fifty rows of it stay calm, and it scales to other verbs (ดู, ลบ)
 * that then read as one family.
 *
 * The label collapses on small screens, leaving the icon alone — the actions
 * column is the first thing to run out of room, and by then the row is a
 * stacked card where the action's meaning is clear from context. The label
 * survives as `sr-only`, so the accessible name never changes with viewport.
 */
export function RowAction({
  href,
  label = 'แก้ไข',
  icon: Icon = Pencil,
  disabled = false,
  className,
}: {
  href: string;
  /** Visible on ≥sm, screen-reader-only below. Defaults to แก้ไข. */
  label?: ReactNode;
  /** Defaults to a pencil. Pass another lucide icon for a different verb. */
  icon?: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  /** Renders inert, for rows the actor may not act on (e.g. a lower tier). */
  disabled?: boolean;
  className?: string;
}) {
  const shared = cn(
    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
    'text-xs font-semibold transition',
    className,
  );

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(shared, 'cursor-not-allowed border-line text-ink-4 opacity-60')}
      >
        <Icon size={13} aria-hidden={true} />
        <span className="sr-only sm:not-sr-only">{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        shared,
        'border-line-strong bg-surface text-ink-2',
        'hover:bg-surface-hover-strong hover:text-ink-1',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400',
      )}
    >
      <Icon size={13} aria-hidden={true} />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}
