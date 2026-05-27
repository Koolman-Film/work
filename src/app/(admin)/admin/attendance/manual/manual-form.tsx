'use client';

/**
 * Manual attendance entry form.
 *
 * Conditional fields: `durationMinutes` is only relevant for Late +
 * EarlyLeave (admin specifies "how many minutes late/early"). For Absent
 * it's meaningless and hidden — preventing the admin from accidentally
 * filling in a number that gets ignored server-side.
 *
 * After successful submit we redirect to /admin so the dashboard's
 * "เช็คอินวันนี้" count refreshes, plus a 1s success toast on the way.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  type CreateManualResult,
  createManualAttendance,
  type ManualAttendanceType,
} from '@/lib/attendance/manual';

type EmployeeOption = { id: string; label: string };

type Props = { employees: EmployeeOption[] };

const TYPE_LABELS: Record<ManualAttendanceType, string> = {
  Absent: 'ขาดงาน',
  Late: 'มาสาย',
  EarlyLeave: 'ออกก่อนเวลา',
};

const TYPE_HINTS: Record<ManualAttendanceType, string> = {
  Absent: 'ไม่มาทำงานทั้งวัน',
  Late: 'มาทำงานแต่หลังเวลาที่กำหนด',
  EarlyLeave: 'มาทำงานแต่ออกก่อนเวลาที่กำหนด',
};

export function ManualAttendanceForm({ employees }: Props) {
  const router = useRouter();

  // Today as YYYY-MM-DD in Bangkok time — same trick as the server uses.
  const today = useMemo(
    () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(today);
  const [type, setType] = useState<ManualAttendanceType>('Absent');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [note, setNote] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showDuration = type === 'Late' || type === 'EarlyLeave';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('กรุณาเลือกพนักงาน');
      return;
    }

    startTransition(async () => {
      const result: CreateManualResult = await createManualAttendance({
        employeeId,
        date,
        type,
        durationMinutes: showDuration ? Number(durationMinutes) : null,
        note,
      });

      if (result.ok) {
        // Redirect back to admin home; toast handled by alert API to keep this
        // form file tiny. The dashboard counts refresh via revalidatePath.
        router.push('/admin');
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
          name="employeeId"
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

      <FormField label="วันที่" htmlFor="date" required>
        <Input
          id="date"
          name="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={today}
          required
        />
      </FormField>

      <FormField label="ประเภท" htmlFor="type" required hint={TYPE_HINTS[type]}>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TYPE_LABELS) as ManualAttendanceType[]).map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition ${
                type === t
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200'
              }`}
            >
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="sr-only"
              />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </FormField>

      {showDuration && (
        <FormField
          label="จำนวนนาที"
          htmlFor="durationMinutes"
          required
          hint={type === 'Late' ? 'จำนวนนาทีที่มาสาย' : 'จำนวนนาทีที่ออกก่อนเวลา'}
        >
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            placeholder="เช่น 30"
            inputMode="numeric"
            required
          />
        </FormField>
      )}

      <FormField label="หมายเหตุ" htmlFor="note" hint="เหตุผลที่ต้องบันทึกด้วยตนเอง (ถ้ามี)">
        <textarea
          id="note"
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="เช่น พนักงานป่วย — ไม่ได้แจ้งล่วงหน้า"
        />
      </FormField>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>
    </form>
  );
}
