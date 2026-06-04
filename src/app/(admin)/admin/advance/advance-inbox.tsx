'use client';

import { useState } from 'react';
import type { ActionResult } from '@/components/ui/confirm-dialog';
import { Dropzone } from '@/components/ui/dropzone';
import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey, statusRail } from '@/components/ui/status-badge';
import { approveCashAdvance, rejectCashAdvance } from '@/lib/advance/admin';
import { voidCashAdvance } from '@/lib/advance/void';
import { compressToJpeg, uploadAdvanceReceipt } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

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
};

function Badge({ row }: { row: AdvanceRowVM }) {
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

export function AdvanceInbox({ rows }: { rows: AdvanceRowVM[] }) {
  const [open, setOpen] = useState<AdvanceRowVM | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isPending = open?.status === 'Pending';

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
    setOpen(null);
  }

  /** Upload the receipt (if any) then approve — runs as ReviewModal's onApprove. */
  async function doApprove(): Promise<ActionResult> {
    if (!open) return { ok: false, message: 'ไม่พบรายการ' };
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
        const compressed = await compressToJpeg(receiptFile);
        const uploaded = await uploadAdvanceReceipt(
          supabase,
          compressed,
          authData.user.id,
          open.id,
        );
        storageKey = uploaded.key;
      }
      return await approveCashAdvance({ cashAdvanceId: open.id, receiptUrl: storageKey });
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
    <>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpen(row)}
              aria-label={`ตรวจสอบคำขอเบิกของ ${row.name}`}
              className={`block w-full border-l-4 ${statusRail(row.statusKey)} px-5 py-4 text-left transition hover:bg-gray-50/70`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge row={row} />
                    <span className="truncate text-sm font-medium text-ink-1">
                      {row.name}
                      {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {row.branch}
                    {row.department ? ` • ${row.department}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-4">
                    ส่งเมื่อ {row.submitted}
                    {row.decidedAt && ` • ตัดสินใจเมื่อ ${row.decidedAt}`}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="display text-2xl font-semibold tabular-nums text-ink-1">
                    {row.amount}
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <ReviewModal
        open={open !== null}
        onClose={closeModal}
        title="ตรวจสอบคำขอเบิก"
        moneyConfirm={isPending && open ? { amountLabel: open.amount } : undefined}
        approveLabel={open ? `อนุมัติ ${open.amount}` : 'อนุมัติ'}
        onApprove={isPending ? doApprove : undefined}
        onReject={
          isPending && open ? () => rejectCashAdvance({ cashAdvanceId: open.id }) : undefined
        }
        onVoid={open ? (reason) => voidCashAdvance(open.id, reason) : undefined}
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge row={open} />
                <span className="text-sm font-medium text-ink-1">
                  {open.name}
                  {open.nickname && <span className="text-ink-3"> ({open.nickname})</span>}
                </span>
              </div>
              <p className="display text-2xl font-semibold tabular-nums text-ink-1">
                {open.amount}
              </p>
            </div>
            <p className="text-xs text-ink-3">
              {open.branch}
              {open.department ? ` • ${open.department}` : ''} — ส่งเมื่อ {open.submitted}
              {open.decidedAt && ` • ตัดสินใจเมื่อ ${open.decidedAt}`}
            </p>

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
                  <div className="mt-1 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
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
              open.receiptUrl && (
                <a
                  href={open.receiptUrl}
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
    </>
  );
}
