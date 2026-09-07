import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * An outlined icon + label control: the app's one shape for "do a thing here".
 *
 * Extracted from RowAction, which fixed this exact problem for table rows —
 * a bare coloured link has no target boundary, so you cannot see where the hit
 * area starts, and it matches nothing else in an app where every other action
 * is a button. The same was still true of the "ดูทั้งหมด →" CTAs in card
 * headers: a stripe of blue prose with a typographic arrow doing the work an
 * icon and a border should do.
 *
 * Neutral rather than blue. These sit next to real content — a card title, a
 * warning banner — and a saturated fill would outrank the thing it belongs to.
 *
 * Renders a <Link> given `href`, a <button> given `onClick`. The button form
 * requires a client component at the call site, which is where the only
 * onClick caller lives.
 */

type Common = {
  label: ReactNode;
  /** Lucide icon. Leads the label, so pick the verb, not decoration. */
  icon: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  /**
   * Hide the label below `sm`, leaving the icon alone. Right for a table's
   * actions column, which is the first thing to run out of room; wrong for a
   * card header, where the label IS the affordance. The label survives as
   * `sr-only`, so the accessible name never changes with viewport.
   */
  collapseLabel?: boolean;
  className?: string;
};

export function ActionLink(
  props: Common & ({ href: string; onClick?: never } | { onClick: () => void; href?: never }),
) {
  const { label, icon: Icon, collapseLabel = false, className } = props;

  const shared = cn(
    // Taller on touch, RowAction's height from `sm` up. RowAction is 30px
    // because it lives in a dense actions column; these stand alone and are
    // often the only target in a card header or a banner, where 30px is a
    // mean thing to ask a thumb for.
    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:px-2.5 sm:py-1.5',
    'text-xs font-semibold transition',
    'border-line-strong bg-surface text-ink-2',
    'hover:bg-surface-hover-strong hover:text-ink-1',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400',
    className,
  );

  const inner = (
    <>
      <Icon size={13} aria-hidden={true} />
      <span className={collapseLabel ? 'sr-only sm:not-sr-only' : undefined}>{label}</span>
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={shared}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={props.onClick} className={shared}>
      {inner}
    </button>
  );
}
