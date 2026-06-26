'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

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
  /**
   * When true, the button is rendered as a loud amber "action needed" CTA with
   * a ⚠ prefix — overriding `variant`. Used for the recalc button when draft
   * numbers are stale, so the action that fixes it is impossible to miss.
   */
  attention?: boolean;
};

function Inner({ label, pendingLabel, variant, attention }: Omit<Props, 'action' | 'month'>) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button type="submit" variant={attention ? 'attention' : variant} disabled={pending}>
        {attention ? `⚠ ${label}` : label}
      </Button>

      {/* Shared Dialog primitive, locked non-dismissable while the mutation
          runs — same blocking semantics ConfirmDialog uses mid-action. */}
      <Dialog open={pending} onClose={() => {}} dismissable={false}>
        <div className="flex flex-col items-center gap-4 py-4">
          <span
            className="size-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-ink-1">{pendingLabel}</p>
          <p className="text-xs text-ink-3">กรุณารอสักครู่ อย่าปิดหน้านี้</p>
        </div>
      </Dialog>
    </>
  );
}

export function RunActionForm({ action, month, label, pendingLabel, variant, attention }: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="month" value={month} />
      <Inner label={label} pendingLabel={pendingLabel} variant={variant} attention={attention} />
    </form>
  );
}
