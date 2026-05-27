'use client';

/**
 * Expandable review panel for a single Pending CashAdvance.
 *
 * Approve: optional receipt URL field + confirms. Note that uploading a
 * receipt photo proper is W4-late (needs Storage); for now admin may
 * paste a URL (Drive link, etc) or leave blank.
 *
 * Reject: just a confirm (no required reason — CashAdvance schema has
 * nowhere to store it, only the audit log keeps the trail).
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveCashAdvance, rejectCashAdvance } from '@/lib/advance/admin';

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
  const [receiptUrl, setReceiptUrl] = useState('');
  const [pending, startTransition] = useTransition();

  function onApprove() {
    startTransition(async () => {
      const r = await approveCashAdvance({
        cashAdvanceId,
        receiptUrl: receiptUrl.trim() || undefined,
      });
      if (r.ok) {
        setLocal({ kind: 'settled', outcome: 'Approved' });
      } else {
        setLocal({ kind: 'error', message: r.message });
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
      <div>
        <label
          htmlFor={`receipt-${cashAdvanceId}`}
          className="block text-xs font-medium text-gray-700"
        >
          ลิงก์ใบเสร็จ <span className="text-gray-400">(ไม่บังคับ)</span>
        </label>
        <input
          id={`receipt-${cashAdvanceId}`}
          type="url"
          value={receiptUrl}
          onChange={(e) => setReceiptUrl(e.target.value)}
          placeholder="https://drive.google.com/..."
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <p className="mt-1 text-[10px] text-gray-500">
          อัปโหลดรูปภาพในแอปจะเปิดให้บริการในรอบถัดไป (W4-late) — ตอนนี้ใช้ลิงก์ภายนอกแทน
        </p>
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
            {pending ? '...' : `อนุมัติ ${amountDisplay}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
