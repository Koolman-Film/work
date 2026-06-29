'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogFooter } from '@/components/ui/dialog-footer';

/**
 * Server-action form for the payroll run buttons (คำนวณ/เผยแพร่/ล็อก) with
 * a blocking progress modal while the action runs (do NOT lose that modal).
 *
 * Why a modal instead of just a spinner on the button: the run actions are
 * long (publish recalculates every employee inside one transaction and the
 * page revalidates after) and mutate money state — letting the admin click
 * other run buttons mid-flight invites double-submits. The overlay
 * communicates "working" AND prevents stray clicks; it unmounts on its own
 * when the action's redirect lands.
 *
 * When `confirm` is set, the trigger button opens a confirm Dialog first;
 * the confirm button inside is a real `type="submit"` so the same pending
 * modal fires after confirmation. The no-confirm path is unchanged.
 */

type Confirm = { title: string; description: string; confirmLabel: string };

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
  /** When set, a confirm dialog gates the submit. */
  confirm?: Confirm;
};

function Inner({
  label,
  pendingLabel,
  variant,
  attention,
  confirm,
}: Omit<Props, 'action' | 'month'>) {
  const { pending } = useFormStatus();
  const [ask, setAsk] = useState(false);

  return (
    <>
      {confirm ? (
        <Button
          type="button"
          variant={attention ? 'attention' : variant}
          disabled={pending}
          onClick={() => setAsk(true)}
        >
          {attention ? `⚠ ${label}` : label}
        </Button>
      ) : (
        <Button type="submit" variant={attention ? 'attention' : variant} disabled={pending}>
          {attention ? `⚠ ${label}` : label}
        </Button>
      )}

      {confirm && (
        <Dialog
          open={ask}
          onClose={() => setAsk(false)}
          title={confirm.title}
          className="sm:max-w-md"
        >
          <p className="mt-2 text-sm text-ink-2">{confirm.description}</p>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAsk(false)}>
              ยกเลิก
            </Button>
            {/* Real submit: closing first lets the pending modal below take over. */}
            <Button type="submit" size="sm" onClick={() => setAsk(false)}>
              {confirm.confirmLabel}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

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

export function RunActionForm({
  action,
  month,
  label,
  pendingLabel,
  variant,
  attention,
  confirm,
}: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="month" value={month} />
      <Inner
        label={label}
        pendingLabel={pendingLabel}
        variant={variant}
        attention={attention}
        confirm={confirm}
      />
    </form>
  );
}
