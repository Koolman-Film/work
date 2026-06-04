import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard modal action bar: right-aligned `sm` buttons, with an optional
 * left-aligned slot (e.g. a destructive "ลบรายการ" link). Shared by
 * ConfirmDialog and ReviewModal so button size/spacing can't drift.
 */
export function DialogFooter({ leading, children }: { leading?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn('mt-5 flex items-center gap-2', leading ? 'justify-between' : 'justify-end')}
    >
      {leading ?? null}
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
