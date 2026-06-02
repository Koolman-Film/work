'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Dialog } from './dialog';

/**
 * Filter controls row. Inline at ≥md; collapses to a "ตัวกรอง" button that
 * opens a bottom-sheet (the shared Dialog) at <md so phones aren't crowded.
 * Children are the actual controls (search box, selects, tab strip).
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop: inline */}
      <div className={cn('hidden flex-wrap items-center gap-2 md:flex', className)}>{children}</div>

      {/* Mobile: trigger + sheet */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-ink-2"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
          </svg>
          ตัวกรอง
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="ตัวกรอง">
          <div className="mt-3 flex flex-col gap-3">{children}</div>
        </Dialog>
      </div>
    </>
  );
}
