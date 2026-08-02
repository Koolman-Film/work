'use client';

/**
 * Approve / reject actions for the LIFF leave review page.
 *
 * Note textarea (required by the server actions) + two-step confirm:
 * the first tap arms the button ("ยืนยัน…"), the second tap fires the
 * server action inside useTransition. Tapping the other button (or
 * typing) disarms. On success → settled banner + router.refresh().
 */

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { approveLeaveRequest, rejectLeaveRequest } from '@/lib/leave/admin';

type Arm = 'approve' | 'reject' | null;

export function LeaveReviewActions({
  leaveRequestId,
  approveBlocked,
}: {
  leaveRequestId: string;
  approveBlocked: boolean;
}) {
  const router = useRouter();
  const t = useTranslations('liffAdmin.leaveActions');
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState<Arm>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [firing, setFiring] = useState<Arm>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: 'approve' | 'reject') {
    if (note.trim().length === 0) {
      setError(t('noteRequired'));
      return;
    }
    if (armed !== kind) {
      setArmed(kind);
      setError('');
      return;
    }
    setArmed(null);
    setFiring(kind);
    startTransition(async () => {
      const result =
        kind === 'approve'
          ? await approveLeaveRequest({ leaveRequestId, note })
          : await rejectLeaveRequest({ leaveRequestId, note });
      if (result.ok) {
        setDone(kind === 'approve' ? 'approved' : 'rejected');
        router.refresh();
      } else {
        setError(result.message);
      }
      setFiring(null);
    });
  }

  if (done) {
    return (
      <section className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-center">
        <p className="text-sm font-medium text-green-800">
          {done === 'approved' ? t('approvedBanner') : t('rejectedBanner')}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <label htmlFor="review-note" className="text-xs font-medium text-gray-500">
        {t('noteLabel')}
      </label>
      <textarea
        id="review-note"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setArmed(null);
        }}
        rows={2}
        placeholder={t('notePlaceholder')}
        className="mt-1 w-full rounded-lg border border-line-strong p-2 text-sm focus:border-primary-500 focus:outline-none"
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isPending || approveBlocked}
          onClick={() => fire('approve')}
          className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
        >
          {isPending && firing === 'approve'
            ? t('saving')
            : armed === 'approve'
              ? t('confirmApprove')
              : t('approve')}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => fire('reject')}
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {isPending && firing === 'reject'
            ? t('saving')
            : armed === 'reject'
              ? t('confirmReject')
              : t('reject')}
        </button>
      </div>
      {approveBlocked && (
        <p className="mt-2 text-[10px] text-gray-400">{t('approveBlockedHint')}</p>
      )}
    </section>
  );
}
