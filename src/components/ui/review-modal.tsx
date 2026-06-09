'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState, useTransition } from 'react';
import { Button } from './button';
import type { ActionResult } from './confirm-dialog';
import { Dialog } from './dialog';
import { DialogFooter } from './dialog-footer';

type Handler = (note: string) => Promise<ActionResult>;

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Page-specific detail body (read-only content). */
  children: ReactNode;
  /** Required note field shown above the footer (leave: required). */
  note?: { required: boolean; placeholder?: string };
  /** When set, approve runs an in-modal "ยืนยัน ฿amount?" step first. */
  moneyConfirm?: { amountLabel: string };
  approveLabel?: string;
  /** Omit approve/reject for read-only (decided) rows. */
  onApprove?: Handler;
  onReject?: Handler;
  /** Footer "ลบรายการ" → in-modal required-reason step. */
  onVoid?: (reason: string) => Promise<ActionResult>;
};

type Mode = 'review' | 'confirm-approve' | 'void';

export function ReviewModal({
  open,
  onClose,
  title,
  children,
  note,
  moneyConfirm,
  approveLabel = 'อนุมัติ',
  onApprove,
  onReject,
  onVoid,
}: Props) {
  const router = useRouter();
  const noteId = useId();
  const [mode, setMode] = useState<Mode>('review');
  const [noteValue, setNoteValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const voidRef = useRef<HTMLTextAreaElement>(null);

  // Focus the void-reason field when its step opens. (Dialog's autofocus only
  // fires on open; the void textarea appears later, on a step transition.)
  useEffect(() => {
    if (mode === 'void') voidRef.current?.focus();
  }, [mode]);

  // Controlled component: reset internal step/inputs whenever the modal closes,
  // so reopening for a different row never shows a stale mode/note/error.
  useEffect(() => {
    if (!open) {
      setMode('review');
      setNoteValue('');
      setReason('');
      setError(null);
    }
  }, [open]);

  function reset() {
    setMode('review');
    setNoteValue('');
    setReason('');
    setError(null);
  }
  function close() {
    reset();
    onClose();
  }
  /** Run an action; on ok close + refresh the list, else show its message. */
  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        close();
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }

  function clickApprove() {
    if (note?.required && !noteValue.trim()) {
      setError('กรุณาระบุหมายเหตุ');
      return;
    }
    if (moneyConfirm) {
      setError(null);
      setMode('confirm-approve');
      return;
    }
    if (onApprove) run(() => onApprove(noteValue.trim()));
  }
  function clickReject() {
    if (note?.required && !noteValue.trim()) {
      setError('กรุณาระบุหมายเหตุ');
      return;
    }
    if (onReject) run(() => onReject(noteValue.trim()));
  }

  return (
    <Dialog open={open} onClose={() => !pending && close()} title={title} dismissable={!pending}>
      {/* Detail body is hidden during the void-reason step to keep focus. */}
      {mode !== 'void' && <div className="mt-2">{children}</div>}

      {mode === 'review' && (onApprove || onReject) && note && (
        <div className="mt-4">
          <label htmlFor={noteId} className="block text-xs font-medium text-ink-2">
            หมายเหตุ {note.required && <span className="text-danger">*</span>}
          </label>
          <textarea
            id={noteId}
            data-autofocus
            rows={2}
            value={noteValue}
            disabled={pending}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder={note.placeholder}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>
      )}

      {mode === 'confirm-approve' && (
        <p className="mt-4 text-sm text-ink-2">
          ยืนยันการอนุมัติ {moneyConfirm?.amountLabel}? การกระทำนี้จะถูกบันทึกในประวัติ
        </p>
      )}

      {mode === 'void' && (
        <div className="mt-2">
          <label htmlFor={`${noteId}-void`} className="block text-xs font-medium text-ink-2">
            เหตุผลที่ลบ <span className="text-danger">*</span>
          </label>
          <textarea
            ref={voidRef}
            id={`${noteId}-void`}
            rows={3}
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น บันทึกผิดวัน / อนุมัติผิดคน"
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">
          {error}
        </p>
      )}

      {mode === 'review' && (
        <DialogFooter
          leading={
            onVoid ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setMode('void');
                }}
                className="text-xs text-danger hover:text-danger-deep disabled:opacity-60"
              >
                ลบรายการ
              </button>
            ) : undefined
          }
        >
          {onReject && (
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={clickReject}
              disabled={pending}
            >
              {pending ? '…' : 'ปฏิเสธ'}
            </Button>
          )}
          {onApprove && (
            <Button
              type="button"
              variant="approve"
              size="sm"
              onClick={clickApprove}
              disabled={pending}
            >
              {pending ? '…' : approveLabel}
            </Button>
          )}
        </DialogFooter>
      )}

      {mode === 'confirm-approve' && (
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              setMode('review');
            }}
            disabled={pending}
          >
            กลับ
          </Button>
          <Button
            type="button"
            variant="approve"
            size="sm"
            onClick={() => onApprove && run(() => onApprove(noteValue.trim()))}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : `ยืนยันอนุมัติ ${moneyConfirm?.amountLabel ?? ''}`.trim()}
          </Button>
        </DialogFooter>
      )}

      {mode === 'void' && (
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              setMode('review');
            }}
            disabled={pending}
          >
            กลับ
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              if (!reason.trim()) {
                setError('กรุณาระบุเหตุผล');
                return;
              }
              if (onVoid) run(() => onVoid(reason.trim()));
            }}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : 'ยืนยันลบ'}
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  );
}
