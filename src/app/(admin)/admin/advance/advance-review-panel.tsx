'use client';

/**
 * Expandable review panel for a single Pending CashAdvance.
 *
 * Ported to the shared Sapphire system:
 *   - Receipt affordance uses the shared `Dropzone`.
 *   - Approve and Reject both route through the shared `ConfirmDialog`
 *     (money is sensitive — the approve confirm shows the ฿amount).
 *
 * Approve: pick receipt (optional) → confirm → the dialog action
 * compresses + uploads the receipt to Storage, then calls
 * `approveCashAdvance` with the resulting storage key. Upload happens
 * INSIDE the confirm action so a failed upload surfaces an inline error
 * and the row is never marked Approved without its receipt.
 *
 * Reject: confirm-only (no required reason — CashAdvance schema has
 * nowhere to persist it; the audit log keeps the trail).
 *
 * `refreshOnSuccess={false}`: the page is dynamic and the action no
 * longer revalidates, so the row stays put and this panel shows its own
 * "settled" confirmation. The admin refreshes to drop settled rows.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ActionResult, ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dropzone } from '@/components/ui/dropzone';
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
  | { kind: 'settled'; outcome: 'Approved' | 'Rejected' };

export function AdvanceReviewPanel({ cashAdvanceId, amountDisplay }: Props) {
  const [local, setLocal] = useState<LocalState>({ kind: 'closed' });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  function handleFile(file: File) {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(file);
    setReceiptPreviewUrl(URL.createObjectURL(file));
  }

  function clearReceipt() {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptFile(null);
    setReceiptPreviewUrl(null);
  }

  /** Upload receipt (if any) then approve. Runs as the ConfirmDialog action. */
  async function doApprove(): Promise<ActionResult> {
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) {
          return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
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

      const r = await approveCashAdvance({ cashAdvanceId, receiptUrl: storageKey });
      if (!r.ok) return { ok: false, message: r.message };
      setLocal({ kind: 'settled', outcome: 'Approved' });
      return { ok: true };
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'kind' in err
          ? errMessage(err as { kind: string; message?: string })
          : err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาด';
      return { ok: false, message };
    }
  }

  async function doReject(): Promise<ActionResult> {
    const r = await rejectCashAdvance({ cashAdvanceId });
    if (!r.ok) return { ok: false, message: r.message };
    setLocal({ kind: 'settled', outcome: 'Rejected' });
    return { ok: true };
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
      <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs">
        {local.outcome === 'Approved' ? (
          <p className="text-success-deep">✓ อนุมัติ {amountDisplay} เรียบร้อย — รีเฟรชเพื่อดูรายการที่เหลือ</p>
        ) : (
          <p className="text-ink-2">✕ ปฏิเสธเรียบร้อย — รีเฟรชเพื่อดูรายการที่เหลือ</p>
        )}
      </div>
    );
  }

  // 'reviewing'
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50/40 p-4">
      {/* Receipt upload */}
      <div>
        <p className="text-xs font-medium text-ink-2">
          ใบเสร็จ <span className="text-ink-4">(ไม่บังคับ — แนะนำให้แนบ)</span>
        </p>
        {!receiptPreviewUrl ? (
          <Dropzone
            className="mt-1"
            label="เลือกรูปใบเสร็จ"
            hint="JPG / PNG / WEBP, สูงสุด ~5MB"
            accept="image/jpeg,image/png,image/webp"
            onFile={handleFile}
          />
        ) : (
          <div className="mt-1 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
            {/* biome-ignore lint/performance/noImgElement: object-URL preview can't use next/image */}
            <img
              src={receiptPreviewUrl}
              alt="ตัวอย่างใบเสร็จ"
              className="h-20 w-20 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink-1">{receiptFile?.name}</p>
              <p className="mt-0.5 text-[10px] text-ink-3">
                {receiptFile ? `${Math.round(receiptFile.size / 1024)} KB ก่อนบีบอัด` : ''}
              </p>
              <button
                type="button"
                onClick={clearReceipt}
                className="mt-1 text-[11px] text-danger hover:text-danger-deep"
              >
                ลบ
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            clearReceipt();
            setLocal({ kind: 'closed' });
          }}
          className="text-xs text-ink-3 hover:text-ink-2"
        >
          ปิด
        </button>
        <div className="flex gap-2">
          <ConfirmDialog
            trigger={(open) => (
              <Button type="button" variant="reject" onClick={open}>
                ปฏิเสธ
              </Button>
            )}
            title="ยืนยันการปฏิเสธ"
            description={`ปฏิเสธคำขอเบิก ${amountDisplay}? การกระทำนี้จะถูกบันทึกในประวัติ`}
            confirmLabel="ยืนยันปฏิเสธ"
            tone="danger"
            refreshOnSuccess={false}
            action={doReject}
          />
          <ConfirmDialog
            trigger={(open) => (
              <Button type="button" variant="approve" onClick={open}>
                อนุมัติ {amountDisplay}
              </Button>
            )}
            title="ยืนยันการอนุมัติ"
            description={`อนุมัติการเบิก ${amountDisplay}? ระบบจะบันทึกผู้อนุมัติและเวลา${
              receiptFile ? ' พร้อมแนบใบเสร็จ' : ' (ยังไม่ได้แนบใบเสร็จ)'
            }`}
            confirmLabel="ยืนยันอนุมัติ"
            tone="primary"
            refreshOnSuccess={false}
            action={doApprove}
          />
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
