'use client';

/**
 * Client actions for the LIFF advance review page.
 *
 * AdvanceReviewActions — approve / reject with two-step confirm (no
 * receipt at approval; the slip is attached later via SlipUploadBlock,
 * matching the two-step payment flow).
 *
 * SlipUploadBlock — image picker → compressToJpeg → uploadAdvanceReceipt
 * to `{sessionAuthUid}/advance-receipts/{cashAdvanceId}.jpg` (upsert) →
 * markAdvancePaid({ cashAdvanceId, receiptKey }) → router.refresh().
 * markAdvancePaid validates the key prefix against the session auth uid,
 * which is why the upload uses (await supabase.auth.getUser()).id.
 */

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { approveCashAdvance, markAdvancePaid, rejectCashAdvance } from '@/lib/advance/admin';
import { compressToJpeg, uploadAdvanceReceipt } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type Arm = 'approve' | 'reject' | null;

export function AdvanceReviewActions({ cashAdvanceId }: { cashAdvanceId: string }) {
  const router = useRouter();
  const t = useTranslations('liffAdmin.advanceActions');
  const [armed, setArmed] = useState<Arm>(null);
  const [firing, setFiring] = useState<Arm>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: 'approve' | 'reject') {
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
          ? await approveCashAdvance({ cashAdvanceId })
          : await rejectCashAdvance({ cashAdvanceId });
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
    <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isPending}
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
      <p className="mt-2 text-[10px] text-gray-400">{t('hint')}</p>
    </section>
  );
}

export function SlipUploadBlock({
  cashAdvanceId,
  heading,
  buttonLabel,
}: {
  cashAdvanceId: string;
  heading: string;
  buttonLabel: string;
}) {
  const router = useRouter();
  const t = useTranslations('liffAdmin.advanceActions');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [doneOnce, setDoneOnce] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const sessionAuthUid = authData.user?.id;
      if (!sessionAuthUid) {
        setError(t('noSession'));
        return;
      }
      const blob = await compressToJpeg(file);
      const { key } = await uploadAdvanceReceipt(supabase, blob, sessionAuthUid, cashAdvanceId);
      const result = await markAdvancePaid({ cashAdvanceId, receiptKey: key });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDoneOnce(true);
      router.refresh();
    } catch (err) {
      const e = err as { kind?: string; message?: string };
      setError(e?.kind === 'too-large-after-compress' ? t('tooLarge') : t('uploadFailed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">{heading}</h2>
      {doneOnce && (
        <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-800">{t('slipDone')}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="mt-3 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
      >
        {uploading ? t('uploading') : buttonLabel}
      </button>
    </section>
  );
}

/**
 * Mark an advance paid without attaching a slip — the slip is optional
 * (Task 1) and can be attached later via SlipUploadBlock, so this button
 * gives the payer a way to record payment right away.
 */
export function MarkPaidButton({ cashAdvanceId, label }: { cashAdvanceId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // No receiptKey — the slip is optional and can be attached later.
            const result = await markAdvancePaid({ cashAdvanceId });
            if (result.ok) router.refresh();
            else setError(result.message);
          })
        }
        className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? '...' : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
