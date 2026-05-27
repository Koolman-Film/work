'use client';

/**
 * Expandable review panel for a single Pending CashAdvance.
 *
 * Approve: receipt file picker (compresses + uploads to Storage,
 * passes the resulting storage key as `receiptUrl` to the action) +
 * confirm. Receipt is optional in W4d but admins are strongly
 * nudged to attach one — the file picker is the primary affordance.
 *
 * Reject: confirm-only (no required reason — CashAdvance schema has
 * nowhere to persist it, only the audit log keeps the trail).
 *
 * Upload UX:
 *   - Pick image → preview thumbnail + filename
 *   - Click approve → compress to JPEG ~200KB → upload to bucket →
 *     storage key gets passed in the approve action
 *   - All in one tap; no separate "upload first, then approve" step
 *
 * Why upload-then-approve (vs upload-after-approve):
 *   If the upload fails, we want to fail BEFORE marking the row
 *   Approved. If we approved first and then failed to attach, the row
 *   would be approved with no receipt — auditable confusion. Coupling
 *   them keeps the contract "approved advances always have either a
 *   receipt or were approved during the W4d transition period."
 */

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveCashAdvance, rejectCashAdvance } from '@/lib/advance/admin';
import { compressToJpeg, uploadAdvanceReceipt } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type Props = {
  cashAdvanceId: string;
  /** Pre-formatted ฿X,XXX display for the confirm prompt. */
  amountDisplay: string;
};

type LocalState =
  | { kind: 'closed' }
  | { kind: 'reviewing' }
  | { kind: 'confirming-reject' }
  | { kind: 'settled'; outcome: 'Approved' | 'Rejected' }
  | { kind: 'error'; message: string };

export function AdvanceReviewPanel({ cashAdvanceId, amountDisplay }: Props) {
  const [local, setLocal] = useState<LocalState>({ kind: 'closed' });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(file);
    setReceiptPreviewUrl(URL.createObjectURL(file));
  }

  function clearReceipt() {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(null);
    setReceiptPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onApprove() {
    startTransition(async () => {
      try {
        let storageKey: string | undefined;

        // Upload receipt FIRST. If the upload fails, we surface a
        // clear error before touching the DB.
        if (receiptFile) {
          const supabase = createClient();
          const { data: authData } = await supabase.auth.getUser();
          if (!authData.user) {
            setLocal({
              kind: 'error',
              message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่',
            });
            return;
          }
          const compressed = await compressToJpeg(receiptFile);
          const uploaded = await uploadAdvanceReceipt(
            supabase,
            compressed,
            authData.user.id,
            cashAdvanceId,
          );
          storageKey = uploaded.key;
        }

        const r = await approveCashAdvance({
          cashAdvanceId,
          receiptUrl: storageKey,
        });
        if (r.ok) {
          setLocal({ kind: 'settled', outcome: 'Approved' });
        } else {
          setLocal({ kind: 'error', message: r.message });
        }
      } catch (err) {
        const message =
          typeof err === 'object' && err !== null && 'kind' in err
            ? errMessage(err as { kind: string; message?: string })
            : err instanceof Error
              ? err.message
              : 'เกิดข้อผิดพลาด';
        setLocal({ kind: 'error', message });
      }
    });
  }

  function onReject() {
    startTransition(async () => {
      const r = await rejectCashAdvance({ cashAdvanceId });
      if (r.ok) {
        setLocal({ kind: 'settled', outcome: 'Rejected' });
      } else {
        setLocal({ kind: 'error', message: r.message });
      }
    });
  }

  if (local.kind === 'closed') {
    return (
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setLocal({ kind: 'reviewing' })}
          className="text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ตรวจสอบ →
        </button>
      </div>
    );
  }

  if (local.kind === 'settled') {
    return (
      <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs">
        {local.outcome === 'Approved' ? (
          <p className="text-green-700">✓ อนุมัติ {amountDisplay} เรียบร้อย — รีเฟรชเพื่อดูรายการที่เหลือ</p>
        ) : (
          <p className="text-gray-700">✕ ปฏิเสธเรียบร้อย — รีเฟรชเพื่อดูรายการที่เหลือ</p>
        )}
      </div>
    );
  }

  if (local.kind === 'confirming-reject') {
    return (
      <div className="mt-3 space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
        <p className="text-sm text-red-900">ยืนยันการปฏิเสธคำขอเบิก {amountDisplay}?</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setLocal({ kind: 'reviewing' })}
            disabled={pending}
          >
            กลับ
          </Button>
          <Button type="button" variant="destructive" onClick={onReject} disabled={pending}>
            {pending ? '...' : 'ยืนยันปฏิเสธ'}
          </Button>
        </div>
      </div>
    );
  }

  // 'reviewing' or 'error'
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50/40 p-4">
      {/* Receipt upload */}
      <div>
        <label
          htmlFor={`receipt-${cashAdvanceId}`}
          className="block text-xs font-medium text-gray-700"
        >
          ใบเสร็จ <span className="text-gray-400">(ไม่บังคับ — แนะนำให้แนบ)</span>
        </label>

        {!receiptPreviewUrl ? (
          <label
            htmlFor={`receipt-${cashAdvanceId}`}
            className="mt-1 flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500 hover:border-primary-300 hover:bg-primary-50/30"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-8 w-8 text-gray-400"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            <span className="mt-2 font-medium text-gray-700">เลือกรูปใบเสร็จ</span>
            <span className="text-xs">JPG / PNG / WEBP, สูงสุด ~5MB</span>
          </label>
        ) : (
          <div className="mt-1 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
            {/* biome-ignore lint/performance/noImgElement: object-URL preview can't use next/image */}
            <img
              src={receiptPreviewUrl}
              alt="ตัวอย่างใบเสร็จ"
              className="h-20 w-20 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-gray-900">{receiptFile?.name}</p>
              <p className="mt-0.5 text-[10px] text-gray-500">
                {receiptFile ? `${Math.round(receiptFile.size / 1024)} KB ก่อนบีบอัด` : ''}
              </p>
              <button
                type="button"
                onClick={clearReceipt}
                disabled={pending}
                className="mt-1 text-[11px] text-red-600 hover:text-red-700"
              >
                ลบ
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          id={`receipt-${cashAdvanceId}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>

      {local.kind === 'error' && <p className="text-xs text-red-700">{local.message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setLocal({ kind: 'closed' })}
          disabled={pending}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ปิด
        </button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setLocal({ kind: 'confirming-reject' })}
            disabled={pending}
          >
            ปฏิเสธ
          </Button>
          <Button type="button" variant="primary" onClick={onApprove} disabled={pending}>
            {pending ? (receiptFile ? 'กำลังอัปโหลด...' : '...') : `อนุมัติ ${amountDisplay}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function errMessage(e: { kind: string; message?: string }): string {
  switch (e.kind) {
    case 'decode-failed':
      return 'อ่านไฟล์รูปไม่ได้';
    case 'upload-failed':
      return `อัปโหลดไม่สำเร็จ: ${e.message ?? ''}`;
    case 'too-large-after-compress':
      return 'รูปใหญ่เกินไป กรุณาลองใหม่';
    default:
      return 'เกิดข้อผิดพลาด';
  }
}
