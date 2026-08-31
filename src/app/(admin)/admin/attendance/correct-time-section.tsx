'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { correctAttendanceTime } from '@/lib/attendance/correct-time';

/**
 * Clock-time correction, in the attendance detail modal.
 *
 * Collapsed behind a link rather than shown open: this edit MOVES MONEY —
 * changing the clock-in changes lateness, which changes the attendance
 * deduction — so it should take a deliberate click, not sit next to the
 * read-only facts inviting a stray edit.
 *
 * Everything here is convenience. The server action re-validates the times,
 * requires the reason, refuses a closed payroll month, and writes the audit
 * entry in the same transaction as the change.
 */
export function CorrectTimeSection({
  attendanceId,
  clockInLabel,
  clockOutLabel,
  onDone,
}: {
  attendanceId: string;
  /** "HH:MM" as currently stored, used to prefill. */
  clockInLabel: string | null;
  clockOutLabel: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clockIn, setClockIn] = useState(clockInLabel ?? '');
  const [clockOut, setClockOut] = useState(clockOutLabel ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-primary-700 hover:underline"
      >
        แก้ไขเวลาเข้า-ออก
      </button>
    );
  }

  const canSubmit = clockIn.trim() !== '' && reason.trim() !== '' && !pending;

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-muted p-3">
      <p className="text-xs font-medium text-ink-2">แก้ไขเวลาเข้า-ออก</p>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-ink-3">
          เข้า
          <input
            type="time"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className="ml-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          ออก
          <input
            type="time"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className="ml-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink-1"
          />
        </label>
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เหตุผล (จำเป็น) เช่น เครื่องสแกนค้าง"
        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink-1"
      />
      <p className="text-[11px] text-ink-4">
        ระบบจะคำนวณสถานะมาสายใหม่ให้อัตโนมัติ และบันทึกเวลาเดิมไว้ในประวัติการแก้ไข
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await correctAttendanceTime({
                attendanceId,
                clockIn,
                clockOut: clockOut.trim() === '' ? null : clockOut,
                reason,
              });
              if (res.ok) {
                router.refresh();
                onDone();
              } else {
                setError(res.message);
              }
            })
          }
          className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-3 hover:text-ink-2"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
