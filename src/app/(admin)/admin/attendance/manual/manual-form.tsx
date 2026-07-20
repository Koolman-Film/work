'use client';

/**
 * Manual attendance entry form.
 *
 * Structured as "did they work?" rather than "which anomaly was it?",
 * because CheckIn and Late are separate rows that legitimately co-occur —
 * the old three mutually-exclusive buttons had no way to say "worked, but
 * couldn't tap the phone", which pushed admins toward ขาดงาน and deducted
 * pay from people who had worked a full day.
 *
 * The live preview panel calls `computeManualPreview` — the exact function
 * the server action uses — so what the admin is shown is what gets saved.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { payrollPeriodFor } from '@/lib/advance/period-earnings';
import { isClosedDay } from '@/lib/attendance/date';
import { latePolicyFrom, resolveLatePolicy } from '@/lib/attendance/late-policy';
import { type CreateManualResult, createManualAttendance } from '@/lib/attendance/manual';
import { computeManualPreview } from '@/lib/attendance/manual-preview';
import { dailyRateFor } from '@/lib/payroll/day-rate';
import {
  getPenaltyLeaveBalance,
  getPenaltySettlement,
  setPenaltySettlement,
} from '@/lib/payroll/penalty-settlement-admin';

/**
 * Which pay-period month a date's penalty belongs to — delegates to
 * `payrollPeriodFor`'s cutoff-day arithmetic (the same math the advance cap
 * and payroll run use) rather than re-deriving it here. Its `end` is the
 * inclusive last day of the window, so that day's YYYY-MM prefix is exactly
 * the `month` `payrollMonthWindow` would build back from.
 */
function payrollMonthFor(dateYmd: string, cutoffDay: number): string {
  return payrollPeriodFor(dateYmd, cutoffDay).end.slice(0, 7);
}

const SETTLEMENT_ERROR_TH: Record<string, string> = {
  'invalid-days': 'จำนวนวันไม่ถูกต้อง',
  'period-closed': 'ปิดรอบเงินเดือนของเดือนนี้แล้ว',
  'leave-type-not-allowed': 'ประเภทวันลาที่เลือกไม่รองรับการหักค่าปรับนี้',
  'insufficient-balance': 'สิทธิวันลาคงเหลือไม่พอ',
};

type ScheduleDay = { dayOfWeek: number; startTime: string; endTime: string };

type EmployeeOption = {
  id: string;
  label: string;
  salaryType: 'Monthly' | 'Daily' | 'Hourly';
  baseSalary: string;
  lateToleranceMin: number | null;
  scheduleDays: ScheduleDay[] | null;
};

type PenaltyLeaveTypeOption = { id: string; name: string };

type Props = {
  employees: EmployeeOption[];
  companyPolicy: { workStartTime: string | null; lateGraceMinutes: number | null };
  rates: { absentPerDay: string; earlyLeave: string };
  holidayYmds: string[];
  /** `PayrollConfig.otThresholdMinutes` (already defaulted by the server). */
  otThresholdMinutes: number;
  /** `PayrollConfig.workingDaysPerMonth` (already defaulted by the server). */
  workingDaysPerMonth: number;
  /** `PayrollConfig.cutoffDay` (already defaulted by the server) — resolves
   *  which pay-period month a settlement's absence date belongs to. */
  cutoffDay: number;
  /** Whether the signed-in admin holds `payroll.run`. When false, the
   *  money/leave choice must not render at all — no disabled control. */
  canSettle: boolean;
  /** Leave types archived=null && penaltySettlementAllowed=true. Empty when !canSettle. */
  penaltyLeaveTypes: PenaltyLeaveTypeOption[];
};

const baht = (v: string) => `฿${Number(v).toLocaleString()}`;

export function ManualAttendanceForm({
  employees,
  companyPolicy,
  rates,
  holidayYmds,
  otThresholdMinutes,
  workingDaysPerMonth,
  cutoffDay,
  canSettle,
  penaltyLeaveTypes,
}: Props) {
  const router = useRouter();

  const today = useMemo(
    () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<'worked' | 'absent'>('worked');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [exemptLate, setExemptLate] = useState(false);
  const [exemptReason, setExemptReason] = useState('');
  const [recordEarlyLeave, setRecordEarlyLeave] = useState(false);
  const [note, setNote] = useState('');
  const [settleWith, setSettleWith] = useState<'money' | 'leave'>('money');
  const [settleLeaveTypeId, setSettleLeaveTypeId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const employee = employees.find((e) => e.id === employeeId) ?? null;

  // Only meaningful when kind === 'absent' && canSettle — the other two
  // penalty kinds (LateThreeStrike, SevereLate) don't exist at manual-entry
  // time, they only emerge when payroll counts the period.
  const showSettleChoice = kind === 'absent' && canSettle;

  const [employeeRemainingDays, setEmployeeRemainingDays] = useState<Record<string, number>>({});
  const [existingSettlement, setExistingSettlement] = useState<{
    days: number;
    leaveTypeName: string;
  } | null>(null);

  // Balance preview must be checked against the payroll YEAR the entry's own
  // (possibly backdated) date belongs to, not today's calendar year — the
  // same year `setPenaltySettlement` derives from `month` server-side.
  // Fetched lazily rather than baked into page props, since it depends on
  // the date the admin is about to pick.
  useEffect(() => {
    if (!showSettleChoice || settleWith !== 'leave' || !employeeId) {
      setEmployeeRemainingDays({});
      return;
    }
    let cancelled = false;
    getPenaltyLeaveBalance({ employeeId, month: payrollMonthFor(date, cutoffDay) }).then((days) => {
      if (!cancelled) setEmployeeRemainingDays(days);
    });
    return () => {
      cancelled = true;
    };
  }, [showSettleChoice, settleWith, employeeId, date, cutoffDay]);

  // setPenaltySettlement upserts on (employeeId, month, kind) — a second
  // "หักสิทธิ" pick for the same employee/month REPLACES the first rather
  // than adding to it. Warn before that happens rather than after, since the
  // save itself succeeds silently either way.
  useEffect(() => {
    if (!showSettleChoice || settleWith !== 'leave' || !employeeId) {
      setExistingSettlement(null);
      return;
    }
    let cancelled = false;
    getPenaltySettlement({
      employeeId,
      month: payrollMonthFor(date, cutoffDay),
      kind: 'Absent',
    }).then((result) => {
      if (!cancelled) setExistingSettlement(result);
    });
    return () => {
      cancelled = true;
    };
  }, [showSettleChoice, settleWith, employeeId, date, cutoffDay]);

  // This employee's actual per-day deduction — same function, same inputs
  // `calcPayroll` uses, so the preview can never disagree with the charge.
  // `null` until an employee is picked: showing the flat config fallback
  // here would be exactly the stale, employee-agnostic figure this fix
  // exists to remove.
  const absentDayRate = useMemo(() => {
    if (!employee) return null;
    return dailyRateFor(
      { salaryType: employee.salaryType, baseSalary: employee.baseSalary },
      rates.absentPerDay,
      workingDaysPerMonth,
    );
  }, [employee, rates.absentPerDay, workingDaysPerMonth]);

  // Resolve the same way the server does, then preview with the same fn.
  const preview = useMemo(() => {
    if (kind === 'absent') {
      return computeManualPreview({ kind: 'absent', date, latePolicy: null, isOffDay: false });
    }
    if (!clockIn) return null;

    const dateObj = new Date(`${date}T00:00:00.000Z`);
    const dow = dateObj.getUTCDay();
    const scheduleDays = employee?.scheduleDays ?? null;
    const hasSchedule = !!scheduleDays && scheduleDays.length > 0;
    const hasHoliday = holidayYmds.includes(date);
    const latePolicy = resolveLatePolicy(
      scheduleDays,
      employee?.lateToleranceMin ?? null,
      dow,
      latePolicyFrom({
        workStartTime: companyPolicy.workStartTime,
        lateGraceMinutes: companyPolicy.lateGraceMinutes,
      }),
    );
    return computeManualPreview({
      kind: 'worked',
      date,
      clockIn,
      clockOut: clockOut || null,
      latePolicy,
      scheduledEndTime: scheduleDays?.find((d) => d.dayOfWeek === dow)?.endTime ?? null,
      // Must mirror the server's rule exactly (src/lib/attendance/manual.ts):
      // Sunday only counts as an off day for employees with no WorkSchedule.
      isOffDay: hasSchedule ? hasHoliday : isClosedDay(dateObj, hasHoliday),
      exemptLate,
      recordEarlyLeave,
      otThresholdMinutes,
    });
  }, [
    kind,
    date,
    clockIn,
    clockOut,
    employee,
    companyPolicy,
    holidayYmds,
    exemptLate,
    recordEarlyLeave,
    otThresholdMinutes,
  ]);

  const showEarlyLeaveOptIn = (preview?.earlyLeaveMinutes ?? 0) > 0;
  const showExemptOptIn = (preview?.lateMinutes ?? 0) > 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('กรุณาเลือกพนักงาน');
      return;
    }
    if (kind === 'worked' && !clockIn) {
      setError('กรุณากรอกเวลาเข้างาน');
      return;
    }
    if (showSettleChoice && settleWith === 'leave' && !settleLeaveTypeId) {
      setError('กรุณาเลือกประเภทวันลาที่จะใช้หัก');
      return;
    }

    startTransition(async () => {
      const result: CreateManualResult = await createManualAttendance({
        employeeId,
        date,
        kind,
        clockIn: kind === 'worked' ? clockIn : null,
        clockOut: kind === 'worked' && clockOut ? clockOut : null,
        exemptLate: showExemptOptIn ? exemptLate : false,
        exemptReason: showExemptOptIn && exemptLate ? exemptReason : null,
        recordEarlyLeave: showEarlyLeaveOptIn ? recordEarlyLeave : false,
        note,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // The absence row is committed at this point — a settlement failure
      // below must NOT read as "the entry failed". It stays recorded and
      // charged as money (the safe fallback); only the settlement is retried,
      // e.g. later from the payroll reconcile page.
      if (showSettleChoice && settleWith === 'leave' && settleLeaveTypeId) {
        const settled = await setPenaltySettlement({
          employeeId,
          month: payrollMonthFor(date, cutoffDay),
          kind: 'Absent',
          leaveTypeId: settleLeaveTypeId,
          days: 1,
        });
        if (!settled.ok) {
          const reason = SETTLEMENT_ERROR_TH[settled.error] ?? 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
          setError(
            `บันทึกขาดงานเรียบร้อยแล้ว แต่หักสิทธิวันลาไม่สำเร็จ (${reason}) ระบบจะหักเป็นเงินแทน — ` +
              'ไปแก้ไขวิธีหักที่หน้าสรุปเงินเดือนได้ภายหลัง',
          );
          return;
        }
      }

      router.push('/admin');
      router.refresh();
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
        <DateField
          id="date"
          name="date"
          required
          value={date}
          onChange={(iso) => setDate(iso ?? '')}
          max={today}
        />
      </FormField>

      <fieldset className="m-0 min-w-0 space-y-1.5 border-0 p-0">
        {/* px-0 strips the UA's default 2px legend padding so this label
            lines up with the plain <label>s on the fields above. */}
        <legend className="block px-0 text-sm font-medium text-gray-700">
          วันนั้นมาทำงานหรือไม่
          <span className="ml-0.5 text-red-500">*</span>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['worked', 'มาทำงาน'],
              ['absent', 'ไม่มา (ขาดงาน)'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition ${
                kind === value
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200'
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'worked' ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="เวลาเข้างาน" htmlFor="clockIn" required>
            <Input
              id="clockIn"
              name="clockIn"
              type="time"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เวลาออกงาน" htmlFor="clockOut" hint="ถ้ายังไม่ออก เว้นว่างได้">
            <Input
              id="clockOut"
              name="clockOut"
              type="time"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </FormField>
        </div>
      ) : (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-ink-3">
          ถ้าเป็นการลาที่ได้รับอนุมัติ ให้บันทึกผ่านหน้าคำขอลาแทน — ระบบจะสร้างรายการให้เอง
        </p>
      )}

      {preview && preview.warnings.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
          {preview.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-900">
              {w}
            </p>
          ))}
          <p className="pt-1 text-sm font-medium text-ink-1">
            จะบันทึก:{' '}
            {preview.rows
              .map((r) =>
                r.type === 'CheckIn'
                  ? `มาทำงาน${clockIn ? ` ${clockIn}` : ''}${clockOut ? `–${clockOut}` : ''}`
                  : r.type === 'Late'
                    ? `มาสาย ${r.durationMinutes} นาที`
                    : r.type === 'EarlyLeave'
                      ? `ออกก่อนเวลา ${r.durationMinutes} นาที (${baht(rates.earlyLeave)})`
                      : absentDayRate
                        ? `ขาดงาน (${baht(absentDayRate.toFixed(2))})`
                        : 'ขาดงาน',
              )
              .join(' + ')}
          </p>
        </div>
      )}

      {showSettleChoice && (
        <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
          <legend className="block px-0 text-sm font-medium text-gray-700">วิธีหัก</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input
                type="radio"
                name="settleWith"
                value="money"
                checked={settleWith === 'money'}
                onChange={() => setSettleWith('money')}
              />
              หักเงิน{absentDayRate ? ` (${baht(absentDayRate.toFixed(2))})` : ''}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input
                type="radio"
                name="settleWith"
                value="leave"
                checked={settleWith === 'leave'}
                onChange={() => setSettleWith('leave')}
                disabled={penaltyLeaveTypes.length === 0}
              />
              หักสิทธิวันลาแทน 1 วัน
            </label>
          </div>
          {settleWith === 'leave' && (
            <FormField label="ประเภทวันลาที่จะใช้หัก" htmlFor="settleLeaveTypeId" required>
              <select
                id="settleLeaveTypeId"
                name="settleLeaveTypeId"
                value={settleLeaveTypeId}
                onChange={(e) => setSettleLeaveTypeId(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                required
              >
                <option value="">— เลือกประเภทวันลา —</option>
                {penaltyLeaveTypes.map((t) => {
                  const left = employeeRemainingDays[t.id] ?? 0;
                  return (
                    <option key={t.id} value={t.id} disabled={left < 1}>
                      {t.name} (เหลือ {left} วัน){left < 1 ? ' — สิทธิไม่พอ' : ''}
                    </option>
                  );
                })}
              </select>
            </FormField>
          )}
          {settleWith === 'leave' && existingSettlement && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              เดือนนี้มีการหักสิทธิ{existingSettlement.leaveTypeName} {existingSettlement.days} วันอยู่แล้ว —
              การบันทึกครั้งนี้จะ<strong>แทนที่</strong>ยอดเดิม ไม่ใช่บวกเพิ่ม ถ้าต้องการยอดรวมมากกว่านี้
              ให้แก้ที่หน้ากระทบยอดเงินเดือน
            </p>
          )}
        </fieldset>
      )}

      {showExemptOptIn && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-1">
            <input
              type="checkbox"
              checked={exemptLate}
              onChange={(e) => setExemptLate(e.target.checked)}
              className="rounded border-gray-300"
            />
            ยกเว้นการหักมาสายครั้งนี้
          </label>
          {exemptLate && (
            <FormField label="เหตุผลที่ยกเว้น" htmlFor="exemptReason" required>
              <Input
                id="exemptReason"
                name="exemptReason"
                value={exemptReason}
                onChange={(e) => setExemptReason(e.target.value)}
                placeholder="เช่น รถติดเพราะน้ำท่วม"
                required
              />
            </FormField>
          )}
        </div>
      )}

      {showEarlyLeaveOptIn && (
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input
            type="checkbox"
            checked={recordEarlyLeave}
            onChange={(e) => setRecordEarlyLeave(e.target.checked)}
            className="rounded border-gray-300"
          />
          บันทึกเป็น "ออกก่อนเวลา" ด้วย (หัก {baht(rates.earlyLeave)})
        </label>
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
          placeholder="เช่น โทรศัพท์พนักงานเสีย — ยืนยันกับหัวหน้าสาขาแล้ว"
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
