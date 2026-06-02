'use client';

/**
 * Confirm-before-acting dialog (Sapphire Editorial).
 *
 * The single primitive every sensitive/destructive action routes through:
 * approve money, reject, delete, unlink, force-checkout, cancel request, and —
 * with a required `reason` — void. Renders its own trigger via a render-prop so
 * callers control the trigger's look (a destructive-text link, a Button, etc.).
 *
 * The action returns ActionResult; on `{ ok:true }` we close + (optionally)
 * router.refresh() so server-rendered lists re-query. On `{ ok:false }` the
 * message is shown inline and the dialog stays open.
 */
import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

export type ActionResult = { ok: true } | { ok: false; message: string };

type Props = {
  /** Render the trigger; call `open()` to show the dialog. */
  trigger: (open: () => void) => ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** When set, a required textarea is shown; its trimmed value is passed to action. */
  reason?: { label: string; placeholder?: string };
  action: (reason: string) => Promise<ActionResult>;
  /** Refresh the route on success (default true). */
  refreshOnSuccess?: boolean;
};

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  tone = 'primary',
  reason,
  action,
  refreshOnSuccess = true,
}: Props) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setValue('');
    setError(null);
  }

  function confirm() {
    setError(null);
    if (reason && !value.trim()) {
      setError('กรุณาระบุเหตุผล');
      return;
    }
    startTransition(async () => {
      const result = await action(value.trim());
      if (result.ok) {
        close();
        if (refreshOnSuccess) router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => !pending && close()} title={title} dismissable={!pending}>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
        {reason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="block text-xs font-medium text-ink-2">
              {reason.label}
            </label>
            <textarea
              id={reasonId}
              data-autofocus
              rows={3}
              value={value}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
              placeholder={reason.placeholder}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            size="sm"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
