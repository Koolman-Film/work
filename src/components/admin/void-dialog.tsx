'use client';

/**
 * Reusable confirm-with-reason controls for the soft-delete/void feature.
 *
 * `VoidDialog`   — a small destructive-text trigger that opens a modal with a
 *                  REQUIRED reason field, then calls the supplied server action.
 * `RestoreButton`— a one-tap restore used in the "Recently deleted" (trash) view.
 *
 * Both are generic over the action so the same components wire into the
 * attendance, leave, and advance admin lists. On success they call
 * router.refresh() so the list re-queries (voided rows leave the live view).
 */

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

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
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setReason('');
    setError(null);
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError('กรุณาระบุเหตุผล');
      return;
    }
    startTransition(async () => {
      const r = await action(reason.trim());
      if (r.ok) {
        close();
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-red-600 hover:text-red-700"
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${reasonId}-title`}
        >
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-xl">
            <h3 id={`${reasonId}-title`} className="text-base font-semibold text-gray-900">
              {title}
            </h3>
            <p className="mt-1 text-sm text-gray-600">{description}</p>
            <label htmlFor={reasonId} className="mt-4 block text-xs font-medium text-gray-700">
              เหตุผล (จำเป็น)
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={pending}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
              placeholder="เช่น บันทึกผิดวัน / อนุมัติผิดคน"
            />
            {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
                ยกเลิก
              </Button>
              <Button variant="destructive" size="sm" onClick={submit} disabled={pending}>
                {pending ? 'กำลังลบ…' : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
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
