import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { standardDayMinutes, windowMinutes } from '@/lib/leave/units';
import { expandHolidaysWithSubstitutes } from '@/lib/leave/working-days';
import { payrollMonthWindowYmd } from '@/lib/payroll/period';
import { deriveAbsentMinutes } from './derive-absence';
import { isScheduledWorkday } from './schedule';

export type AbsencePreviewDay = { date: string; minutes: number };

export type AbsencePreviewRow = {
  employeeId: string;
  name: string;
  baseSalary: number;
  days: AbsencePreviewDay[];
  totalMinutes: number;
  totalDays: number;
  /** Illustrative only. Nothing consumes this; payroll is untouched. */
  estimatedBaht: number;
  hasSchedule: boolean;
};

export type AbsencePreview = {
  month: string;
  from: string;
  to: string;
  rows: AbsencePreviewRow[];
  standardDayMinutes: number;
  absentDeductionPerDay: number;
  skippedNoSchedule: number;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What absence derivation WOULD produce for one payroll month. Read-only: it
 * computes, it never writes, and nothing in payroll consumes it.
 *
 * Exists because deriving absence is the largest money change in the backlog —
 * it moves `deductAttendance` for potentially every employee. This page is how
 * that gets inspected before a single baht moves.
 */
export async function previewAbsences(month: string): Promise<AbsencePreview> {
  const [payCfg, leaveCfg] = await Promise.all([
    prisma.payrollConfig.findFirstOrThrow({
      select: { cutoffDay: true, absentDeductionPerDay: true },
    }),
    prisma.leaveConfig.findFirst(),
  ]);
  const std = standardDayMinutes(
    leaveCfg ?? {
      morningStart: '09:00',
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: '17:00',
    },
  );
  const { from, to } = payrollMonthWindowYmd(month, payCfg.cutoffDay);
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  const [employees, attendance, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { in: ['Active', 'Probation'] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        baseSalary: true,
        workScheduleId: true,
        workSchedule: {
          select: { days: { select: { dayOfWeek: true, startTime: true, endTime: true } } },
        },
      },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: start, lte: end }, deletedAt: null },
      select: { employeeId: true, date: true, type: true, durationMinutes: true },
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);

  const holidaySet = new Set(expandHolidaysWithSubstitutes(holidays.map((h) => h.date)).map(ymd));

  // Per employee, per date: what happened. `leaveMinutes` stays `undefined`
  // until an OnLeave row is seen, and becomes `null` if that row has no
  // duration — the distinction deriveAbsentMinutes depends on.
  type DayFacts = {
    checkIn: boolean;
    manualAbsent: boolean;
    leaveMinutes: number | null | undefined;
  };
  const facts = new Map<string, Map<string, DayFacts>>();
  const factFor = (empId: string, date: string): DayFacts => {
    let byDate = facts.get(empId);
    if (!byDate) {
      byDate = new Map();
      facts.set(empId, byDate);
    }
    let f = byDate.get(date);
    if (!f) {
      f = { checkIn: false, manualAbsent: false, leaveMinutes: undefined };
      byDate.set(date, f);
    }
    return f;
  };

  for (const a of attendance) {
    const f = factFor(a.employeeId, ymd(a.date));
    if (a.type === 'CheckIn') f.checkIn = true;
    else if (a.type === 'Absent') f.manualAbsent = true;
    else if (a.type === 'OnLeave') {
      // A null duration poisons the sum to null on purpose: unknown coverage is
      // treated as FULL coverage downstream, never as none.
      f.leaveMinutes =
        a.durationMinutes === null || f.leaveMinutes === null
          ? null
          : (f.leaveMinutes ?? 0) + a.durationMinutes;
    }
  }

  const rows: AbsencePreviewRow[] = [];
  let skippedNoSchedule = 0;

  for (const emp of employees) {
    // Guard #2 from the design: with no schedule the system assumes Mon–Sat, so
    // deriving would charge a day's pay for every real day off. Refuse instead.
    if (!emp.workScheduleId || !emp.workSchedule) {
      skippedNoSchedule++;
      continue;
    }
    const minutesByDow = new Map<number, number>(
      emp.workSchedule.days.map((d) => [d.dayOfWeek, windowMinutes(d.startTime, d.endTime)]),
    );
    const dows = [...minutesByDow.keys()];

    const days: AbsencePreviewDay[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const date = ymd(d);
      const dow = d.getUTCDay();
      const f = facts.get(emp.id)?.get(date);
      const minutes = deriveAbsentMinutes({
        scheduledMinutes: minutesByDow.get(dow) ?? 0,
        leaveMinutes: f?.leaveMinutes === undefined ? 0 : f.leaveMinutes,
        hasCheckIn: f?.checkIn ?? false,
        hasManualAbsent: f?.manualAbsent ?? false,
        isWorkday: isScheduledWorkday(dows, dow, holidaySet.has(date)),
      });
      if (minutes > 0) days.push({ date, minutes });
    }

    if (days.length === 0) continue;
    const totalMinutes = days.reduce((s, x) => s + x.minutes, 0);
    const totalDays = totalMinutes / std;
    rows.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}${emp.nickname ? ` (${emp.nickname})` : ''}`,
      baseSalary: Number(emp.baseSalary),
      days,
      totalMinutes,
      totalDays,
      estimatedBaht: totalDays * Number(payCfg.absentDeductionPerDay),
      hasSchedule: true,
    });
  }

  rows.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    month,
    from,
    to,
    rows,
    standardDayMinutes: std,
    absentDeductionPerDay: Number(payCfg.absentDeductionPerDay),
    skippedNoSchedule,
  };
}
