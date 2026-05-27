'use client';

/**
 * Expandable review panel for a single Pending LeaveRequest.
 *
 * Closed state: "ตรวจสอบ →" link.
 * Open state: shows the date-by-date working-day breakdown, surfaces any
 * Holidays inside the range (so admin understands why N days became N-1
 * Attendance rows), and offers note + Approve / Reject buttons.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveLeaveRequest, rejectLeaveRequest } from '@/lib/leave/admin';

type Props = {
  leaveRequestId: string;
  /** YYYY-MM-DD strings of working days (already excludes Sundays + Holidays). */
  workingDays: readonly string[];
  /** Holidays that fall inside the range (informational). */
  holidayNames: readonly { date: string; name: string }[];
};

type LocalState =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'settled'; outcome: 'Approved' | 'Rejected'; attendanceCount?: number }
  | { kind: 'error'; message: string };

export function LeaveReviewPanel({ leaveRequestId, workingDays, holidayNames }: Props) {
  const [local, setLocal] = useState<LocalState>({ kind: 'closed' });
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  function act(decision: 'approve' | 'reject') {
    startTransition(async () => {
      if (decision === 'approve') {
        const r = await approveLeaveRequest({ leaveRequestId, note });
        if (r.ok) {
          setLocal({
            kind: 'settled',
            outcome: 'Approved',
            attendanceCount: r.attendanceRowsCreated,
          });
        } else {
          setLocal({ kind: 'error', message: r.message });
        }
      } else {
        const r = await rejectLeaveRequest({ leaveRequestId, note });
        if (r.ok) {
          setLocal({ kind: 'settled', outcome: 'Rejected' });
        } else {
          setLocal({ kind: 'error', message: r.message });
        }
      }
    });
  }

  if (local.kind === 'closed') {
    return (
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setLocal({ kind: 'open' })}
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
          <p className="text-green-700">
            ✓ อนุมัติเรียบร้อย — สร้างบันทึก {local.attendanceCount ?? '?'} วัน รีเฟรชเพื่อดูรายการที่เหลือ
          </p>
        ) : (
          <p className="text-gray-700">✕ ปฏิเสธเรียบร้อย — รีเฟรชเพื่อดูรายการที่เหลือ</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50/40 p-4">
      {/* Working days breakdown */}
      <div>
        <p className="text-xs font-medium text-gray-700">
          วันทำงานที่จะถูกบันทึก ({workingDays.length} วัน)
        </p>
        {workingDays.length === 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            ⚠ ไม่มีวันทำงานในช่วงที่ขอ (ทั้งหมดเป็นวันอาทิตย์/วันหยุด) — การอนุมัติจะไม่สร้างบันทึกใดๆ
          </p>
        ) : (
          <p className="mt-1 break-all text-[10px] font-mono text-gray-600">
            {workingDays.join(', ')}
          </p>
        )}
        {holidayNames.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            วันหยุดในช่วงนี้: {holidayNames.map((h) => `${h.date} (${h.name})`).join(', ')} —{' '}
            <span className="text-gray-500">ถูกตัดออกจากการคิดเป็นวันลา</span>
          </p>
        )}
      </div>

      {/* Note */}
      <div className="space-y-2">
        <label
          htmlFor={`note-${leaveRequestId}`}
          className="block text-xs font-medium text-gray-700"
        >
          หมายเหตุ <span className="text-red-600">*</span>
        </label>
        <textarea
          id={`note-${leaveRequestId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="เช่น: อนุมัติตามขอ / ปฏิเสธ — ไม่มีเอกสารแนบ"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {local.kind === 'error' && <p className="text-xs text-red-700">{local.message}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setLocal({ kind: 'closed' })}
          disabled={pending}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ยกเลิก
        </button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => act('reject')}
            disabled={pending || note.trim().length === 0}
          >
            {pending ? '...' : 'ปฏิเสธ'}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => act('approve')}
            disabled={pending || note.trim().length === 0}
          >
            {pending ? '...' : 'อนุมัติ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
