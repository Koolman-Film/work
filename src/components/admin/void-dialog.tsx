'use client';

/**
 * Soft-delete/void controls for the attendance/leave/advance admin lists.
 *
 * `VoidDialog`    — destructive-text trigger → confirm with a REQUIRED reason,
 *                   then calls the supplied void server action. Built on the
 *                   shared `ConfirmDialog` so confirm UX lives in one place.
 * `RestoreButton` — one-tap restore in the "Recently deleted" view. Kept as a
 *                   single click (no confirm): restore is non-destructive and
 *                   trivially reversible, so a dialog would be friction without
 *                   safety. On success it refreshes the list.
 *
 * Public API unchanged — callers in the admin lists keep working without edits.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type VoidActionResult = { ok: true } | { ok: false; message: string };

export function VoidDialog({
  triggerLabel,
  title,
  description,
  confirmLabel = 'ลบรายการ',
  action,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel?: string;
  action: (reason: string) => Promise<VoidActionResult>;
}) {
  return (
    <ConfirmDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone="danger"
      reason={{ label: 'เหตุผล (จำเป็น)', placeholder: 'เช่น บันทึกผิดวัน / อนุมัติผิดคน' }}
      action={action}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          className="text-xs font-medium text-red-600 hover:text-red-700"
        >
          {triggerLabel}
        </button>
      )}
    />
  );
}

export function RestoreButton({ action }: { action: () => Promise<VoidActionResult> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs font-medium text-primary-700 hover:text-primary-800 disabled:opacity-60"
      >
        {pending ? 'กำลังกู้คืน…' : 'กู้คืน'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
