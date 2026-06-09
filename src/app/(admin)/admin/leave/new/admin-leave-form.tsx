'use client';

/**
 * Admin "record leave on behalf of an employee" form.
 *
 * Unlike the worker LIFF form, the date inputs carry NO `min` — admins
 * back-date freely (that's the whole reason this page exists). On submit it
 * creates a **Pending** request via `adminCreateLeaveRequest`; the admin is
 * then sent to /admin/leave to approve it, which expands it into
 * Attendance(OnLeave) rows. No attachment / balance preview here — the review
 * modal already surfaces the working-day count at approval time.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { adminCreateLeaveRequest } from '@/lib/leave/admin';
import type { LeaveUnit } from '@/lib/leave/units';

type EmployeeOption = { id: string; label: string };
type LeaveTypeOption = {
  id: string;
  name: string;
  isPaid: boolean;
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
};
type Props = { employees: EmployeeOption[]; leaveTypes: LeaveTypeOption[] };

const UNIT_LABELS: Record<LeaveUnit, string> = {
  FullDay: 'เต็มวัน',
  HalfMorning: 'ครึ่งเช้า',
  HalfAfternoon: 'ครึ่งบ่าย',
  Hourly: 'รายชั่วโมง',
};

export function AdminLeaveForm({ employees, leaveTypes }: Props) {
  const router = useRouter();

  // Today as YYYY-MM-DD in Bangkok — the form's default (admins typically
  // back-date, but we seed "today" and let them pick an earlier day).
  const today = useMemo(
    () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? '');
  const [unit, setUnit] = useState<LeaveUnit>('FullDay');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState('13:00');
  const [endTime, setEndTime] = useState('15:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId);

  // Units the selected type permits — the picker only offers these.
  const allowedUnits = useMemo<{ value: LeaveUnit; label: string }[]>(() => {
    const units: { value: LeaveUnit; label: string }[] = [];
    if (selectedType?.allowFullDay) units.push({ value: 'FullDay', label: UNIT_LABELS.FullDay });
    if (selectedType?.allowHalfDay) {
      units.push({ value: 'HalfMorning', label: UNIT_LABELS.HalfMorning });
      units.push({ value: 'HalfAfternoon', label: UNIT_LABELS.HalfAfternoon });
    }
    if (selectedType?.allowHourly) units.push({ value: 'Hourly', label: UNIT_LABELS.Hourly });
    return units;
  }, [selectedType]);

  // Snap `unit` to the first allowed unit whenever the selected type changes.
  useEffect(() => {
    const first = allowedUnits[0];
    if (first && !allowedUnits.some((u) => u.value === unit)) setUnit(first.value);
  }, [allowedUnits, unit]);

  const isFullDay = unit === 'FullDay';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employeeId) {
      setError('กรุณาเลือกพนักงาน');
      return;
    }
    if (reason.trim().length < 4) {
      setError('กรุณากรอกเหตุผลอย่างน้อย 4 ตัวอักษร');
      return;
    }

    startTransition(async () => {
      const result = await adminCreateLeaveRequest({
        employeeId,
        leaveTypeId,
        startDate,
        endDate: isFullDay ? endDate : startDate,
        reason,
        unit,
        startTime: unit === 'Hourly' ? startTime : null,
        endTime: unit === 'Hourly' ? endTime : null,
      });
      if (result.ok) {
        // Land on the Pending inbox so the admin can approve the request they
        // just created (approval is what writes the attendance rows).
        router.push('/admin/leave');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="พนักงาน" htmlFor="employeeId" required>
        <select
          id="employeeId"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          required
        >
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="ประเภทการลา" htmlFor="leaveTypeId" required>
        <select
          id="leaveTypeId"
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          required
        >
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isPaid ? '' : ' (ไม่จ่าย)'}
            </option>
          ))}
        </select>
      </FormField>

      {allowedUnits.length > 1 && (
        <FormField label="หน่วยการลา" htmlFor="unit">
          <div className="flex flex-wrap gap-2">
            {allowedUnits.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setUnit(u.value)}
                className={
                  unit === u.value
                    ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700'
                    : 'rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700'
                }
              >
                {u.label}
              </button>
            ))}
          </div>
        </FormField>
      )}

      {isFullDay ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="วันที่เริ่ม" htmlFor="startDate" required>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              required
            />
          </FormField>
          <FormField label="วันที่สิ้นสุด" htmlFor="endDate" required>
            <Input
              id="endDate"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </FormField>
        </div>
      ) : (
        <FormField label="วันที่" htmlFor="startDate" required>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </FormField>
      )}

      {unit === 'Hourly' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="เวลาเริ่ม" htmlFor="startTime" required>
            <Input
              id="startTime"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เวลาสิ้นสุด" htmlFor="endTime" required>
            <Input
              id="endTime"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </FormField>
        </div>
      )}

      <FormField label="เหตุผล" htmlFor="reason" required hint="อย่างน้อย 4 ตัวอักษร">
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          minLength={4}
          maxLength={500}
          required
          placeholder="เช่น ป่วย — ยื่นเอกสารย้อนหลัง / ลืมแจ้งลา"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </FormField>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก...' : 'บันทึก → รออนุมัติ'}
        </Button>
      </div>
    </form>
  );
}
