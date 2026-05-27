'use client';

/**
 * Leave-request form — Client Component because we need live working-day
 * count as the user picks dates, and the action result drives the
 * post-submit redirect.
 *
 * Working-day preview is computed client-side from the chosen dates
 * (excluding Sundays). Holidays are NOT factored into the preview — the
 * authoritative count happens on the server side at approval time. The
 * preview is purely "give the employee a ballpark."
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { submitLeaveRequest } from '@/lib/leave/actions';
import { parseInputDate, workingDaysIn } from '@/lib/leave/working-days';

type LeaveTypeOption = {
  id: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
};

type Props = {
  leaveTypes: readonly LeaveTypeOption[];
  /** YYYY-MM-DD for the date input min — today in Bangkok. */
  minDate: string;
};

export function LeaveNewForm({ leaveTypes, minDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [leaveTypeId, setLeaveTypeId] = useState<string>(leaveTypes[0]?.id ?? '');
  const [startDate, setStartDate] = useState<string>(minDate);
  const [endDate, setEndDate] = useState<string>(minDate);
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Client-preview of working-day count. Excludes Sundays only — server
  // is the source of truth for the holiday-aware count.
  const workingDayCount = useMemo(() => {
    const s = parseInputDate(startDate);
    const e = parseInputDate(endDate);
    if (!s || !e) return null;
    if (e.getTime() < s.getTime()) return null;
    return workingDaysIn({ startDate: s, endDate: e, holidays: [] }).length;
  }, [startDate, endDate]);

  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await submitLeaveRequest({
        leaveTypeId,
        startDate,
        endDate,
        reason,
      });
      if (result.ok) {
        router.push(`/liff/leave/${result.id}`);
      } else {
        setError(result.message);
      }
    });
  }

  const submitDisabled =
    pending ||
    !leaveTypeId ||
    !startDate ||
    !endDate ||
    reason.trim().length < 4 ||
    (workingDayCount != null && workingDayCount === 0);

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">ส่งคำขอลา</h1>
      <p className="mt-1 text-sm text-gray-500">กรอกข้อมูลให้ครบเพื่อส่งคำขอไปยังแอดมิน</p>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Leave type */}
        <div>
          <label htmlFor="leaveTypeId" className="mb-1.5 block text-sm font-medium text-gray-700">
            ประเภทการลา <span className="text-red-600">*</span>
          </label>
          <select
            id="leaveTypeId"
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isPaid ? '' : ' (ไม่จ่ายเงิน)'}
                {t.annualQuota != null ? ` — โควต้า ${t.annualQuota} วัน` : ''}
              </option>
            ))}
          </select>
          {selectedType && !selectedType.isPaid && (
            <p className="mt-1 text-xs text-amber-700">หมายเหตุ: การลานี้ไม่ได้รับค่าจ้าง</p>
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="startDate" className="mb-1.5 block text-sm font-medium text-gray-700">
              วันเริ่มต้น <span className="text-red-600">*</span>
            </label>
            <input
              id="startDate"
              type="date"
              required
              min={minDate}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                // Auto-bump end if it's now < start.
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="mb-1.5 block text-sm font-medium text-gray-700">
              วันสิ้นสุด <span className="text-red-600">*</span>
            </label>
            <input
              id="endDate"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Working-day preview */}
        {workingDayCount != null && (
          <p className="rounded-md bg-primary-50 px-3 py-2 text-xs text-primary-800">
            ประมาณการ: <strong>{workingDayCount} วันทำงาน</strong>{' '}
            <span className="text-primary-600">(ไม่นับวันอาทิตย์)</span>
            <span className="block text-[10px] text-primary-600/80">
              * แอดมินจะคำนวณรวมวันหยุดอีกครั้งเมื่ออนุมัติ
            </span>
          </p>
        )}

        {/* Reason */}
        <div>
          <label htmlFor="reason" className="mb-1.5 block text-sm font-medium text-gray-700">
            เหตุผล <span className="text-red-600">*</span>
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            minLength={4}
            maxLength={500}
            required
            placeholder="เช่น ลาป่วยไปหาหมอ, ลาไปงานแต่งงานญาติ"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <p className="mt-1 text-right text-[10px] text-gray-400">{reason.length}/500</p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={pending}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'กำลังส่ง...' : 'ส่งคำขอ'}
          </button>
        </div>
      </form>
    </main>
  );
}
