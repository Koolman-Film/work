'use client';

import { useEffect, useState } from 'react';
import type { ActionResult } from '@/components/ui/confirm-dialog';
import { Dropzone } from '@/components/ui/dropzone';
import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { approveCashAdvance, rejectCashAdvance } from '@/lib/advance/admin';
import { voidCashAdvance } from '@/lib/advance/void';
import { compressToJpeg, uploadAdvanceReceipt } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

/** Salary-cap guard for a Pending advance — null for decided rows.
 *  `available` may be null for rate-based employees when earnings can't be
 *  computed (no number shown; approval not blocked client-side — the server
 *  guard still has the final say). */
export type AdvanceGuardVM = {
  available: number | null;
  overCap: boolean;
};

export type AdvanceRowVM = {
  id: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  statusKey: StatusKey;
  statusLabel: string;
  name: string;
  nickname: string | null;
  branch: string;
  department: string | null;
  amount: string;
  submitted: string;
  decidedAt: string | null;
  receiptUrl: string | null;
  advanceGuard: AdvanceGuardVM | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  /**
   * Whether the VIEWER (not the row) may see the payout bank block —
   * `advance.read` alone (individually assignable to custom roles) is not
   * enough to expose full bank account numbers; only holders of
   * `advance.approve` see it. Computed server-side so client code never
   * calls a permission helper itself.
   */
  canSeePayout: boolean;
};

function Badge({ row }: { row: AdvanceRowVM }) {
  // `statusLabel` already resolves Approved into รอจ่ายเงิน / จ่ายเงินแล้ว in
  // buildAdvanceRowVM — deliberately not recomputed here, so this badge and the
  // inbox list can never disagree about the same row.
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

/** Map a structured upload error (thrown with a `kind`) to a Thai message. */
function uploadErrorMessage(e: { kind: string; message?: string }): string {
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

/**
 * Review modal for a single cash advance. `row === null` keeps it closed.
 * Owns the optional receipt-upload flow. Shared by the advance inbox list and
 * the admin calendar's day-detail panel.
 */
export function AdvanceReviewModal({
  row,
  onClose,
  onActioned,
}: {
  row: AdvanceRowVM | null;
  onClose: () => void;
  onActioned?: () => void;
}) {
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isPending = row?.status === 'Pending';

  function pickFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setReceiptFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }
  function clearReceipt() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setReceiptFile(null);
    setPreviewUrl(null);
  }
  function closeModal() {
    clearReceipt();
    onClose();
  }

  // Reset staged receipt whenever the selected row changes (covers open, close,
  // and switching directly between rows) so a receipt never leaks to another advance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearReceipt is stable enough; keying on row?.id is the intent
  useEffect(() => {
    clearReceipt();
  }, [row?.id]);

  /** Upload the receipt (if any) then approve — runs as ReviewModal's onApprove. */
  async function doApprove(): Promise<ActionResult> {
    if (!row) return { ok: false, message: 'ไม่พบรายการ' };
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
        const compressed = await compressToJpeg(receiptFile);
        const uploaded = await uploadAdvanceReceipt(supabase, compressed, authData.user.id, row.id);
        storageKey = uploaded.key;
      }
      return await approveCashAdvance({ cashAdvanceId: row.id, receiptUrl: storageKey });
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'kind' in err
          ? uploadErrorMessage(err as { kind: string; message?: string })
          : err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาด';
      return { ok: false, message };
    }
  }

  return (
    <ReviewModal
      open={row !== null}
      onClose={closeModal}
      onActioned={onActioned}
      title="ตรวจสอบคำขอเบิก"
      moneyConfirm={isPending && row ? { amountLabel: row.amount } : undefined}
      approveLabel={row ? `อนุมัติ ${row.amount}` : 'อนุมัติ'}
      onApprove={isPending ? doApprove : undefined}
      approveDisabled={row?.advanceGuard?.overCap}
      onReject={isPending && row ? () => rejectCashAdvance({ cashAdvanceId: row.id }) : undefined}
      onVoid={row ? (reason) => voidCashAdvance(row.id, reason) : undefined}
    >
      {row && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge row={row} />
              <span className="text-sm font-medium text-ink-1">
                {row.name}
                {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
              </span>
            </div>
            <p className="display text-2xl font-semibold tabular-nums text-ink-1">{row.amount}</p>
          </div>
          <p className="text-xs text-ink-3">
            {row.branch}
            {row.department ? ` • ${row.department}` : ''} — ส่งเมื่อ {row.submitted}
            {row.decidedAt && ` • ตัดสินใจเมื่อ ${row.decidedAt}`}
          </p>

          {/* Salary-cap guard — "การเบิก ไม่เกินเงินเดือน" is hard at approval */}
          {row.advanceGuard && row.advanceGuard.available != null && (
            <p
              className={
                row.advanceGuard.overCap
                  ? 'text-sm font-medium text-red-700'
                  : 'text-sm text-gray-600'
              }
            >
              วงเงินคงเหลือ ฿
              {row.advanceGuard.available.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              {row.advanceGuard.overCap && ' — คำขอนี้เกินวงเงิน ไม่สามารถอนุมัติได้'}
            </p>
          )}

          {/* Payout destination — shown before the receipt so the approver can
              confirm the employee's bank data is complete before approving.
              Gated on canSeePayout (advance.approve) and never shown for a
              decided-no row: a Rejected/Cancelled advance is never paid, so
              there's no reason to expose the account. `advance.read` alone
              (individually assignable) must not surface bank details. */}
          {row.canSeePayout && row.status !== 'Rejected' && row.status !== 'Cancelled' && (
            <section className="rounded-lg border border-line bg-surface-muted p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">โอนเข้าบัญชี</p>
              {row.bankAccountNumber ? (
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">ธนาคาร</dt>
                    <dd className="font-medium text-ink-1">{row.bankName ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">เลขบัญชี</dt>
                    <dd className="font-medium tabular-nums text-ink-1">{row.bankAccountNumber}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-3">ชื่อบัญชี</dt>
                    <dd className="font-medium text-ink-1">{row.bankAccountName ?? '—'}</dd>
                  </div>
                </dl>
              ) : (
                // Never render an empty block: the approver must be able to tell
                // "no data entered" apart from "the screen is broken".
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  ยังไม่ได้กรอกข้อมูลบัญชีธนาคารของพนักงานคนนี้ — ต้องกรอกก่อนโอน
                </p>
              )}
            </section>
          )}

          {isPending ? (
            <div>
              <p className="text-xs font-medium text-ink-2">
                ใบเสร็จ <span className="text-ink-4">(ไม่บังคับ — แนะนำให้แนบ)</span>
              </p>
              {!previewUrl ? (
                <Dropzone
                  className="mt-1"
                  label="เลือกรูปใบเสร็จ"
                  hint="JPG / PNG / WEBP, สูงสุด ~5MB"
                  accept="image/jpeg,image/png,image/webp"
                  onFile={pickFile}
                />
              ) : (
                <div className="mt-1 flex items-start gap-3 rounded-lg border border-line bg-surface p-3">
                  {/* biome-ignore lint/performance/noImgElement: object-URL preview */}
                  <img
                    src={previewUrl}
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
          ) : (
            row.receiptUrl && (
              <a
                href={row.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs font-medium text-primary-700 underline hover:text-primary-800"
              >
                ดูใบเสร็จ →
              </a>
            )
          )}
        </div>
      )}
    </ReviewModal>
  );
}
