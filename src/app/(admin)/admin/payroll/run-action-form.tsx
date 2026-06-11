'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/**
 * Server-action form for the payroll run buttons (คำนวณ/เผยแพร่/ล็อก) with
 * a blocking progress modal while the action runs.
 *
 * Why a modal instead of just a spinner on the button: the run actions are
 * long (publish recalculates every employee inside one transaction and the
 * page revalidates after) and mutate money state — letting the admin click
 * other run buttons mid-flight invites double-submits. The overlay
 * communicates "working" AND prevents stray clicks; it unmounts on its own
 * when the action's redirect lands.
 */

type Props = {
  action: (formData: FormData) => Promise<void>;
  month: string;
  label: string;
  /** Modal headline while running, e.g. "กำลังคำนวณเงินเดือน…" */
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
};

function Inner({ label, pendingLabel, variant }: Omit<Props, 'action' | 'month'>) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>

      {pending && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-1/40"
          role="alertdialog"
          aria-modal="true"
          aria-label={pendingLabel}
        >
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 shadow-xl">
            <span
              className="size-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-ink-1">{pendingLabel}</p>
            <p className="text-xs text-ink-3">กรุณารอสักครู่ อย่าปิดหน้านี้</p>
          </div>
        </div>
      )}
    </>
  );
}

export function RunActionForm({ action, month, label, pendingLabel, variant }: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="month" value={month} />
      <Inner label={label} pendingLabel={pendingLabel} variant={variant} />
    </form>
  );
}
