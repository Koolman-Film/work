import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { standardDayMinutes } from '@/lib/leave/units';
import { expandHolidaysWithSubstitutes } from '@/lib/leave/working-days';
import { isPayrollChargeableSalaryType } from '@/lib/payroll/calc';
import { payrollMonthWindowYmd } from '@/lib/payroll/period';
import { type BreakWindow, deriveAbsentMinutes, scheduledWorkMinutes } from './derive-absence';
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
  /** Employees payroll refuses to process at all — see the filter below. */
  skippedNotChargeable: number;
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
  const cfg = leaveCfg ?? {
    morningStart: '09:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  };
  const std = standardDayMinutes(cfg);
  // The unpaid gap between the two leave windows. A WorkScheduleDay window is
  // wall-clock and includes it; a leave day does not. Without removing it every
  // full day of leave leaves a phantom absence — see scheduledWorkMinutes.
  const brk: BreakWindow | null =
    cfg.afternoonStart > cfg.morningEnd ? { start: cfg.morningEnd, end: cfg.afternoonStart } : null;
  const { from, to } = payrollMonthWindowYmd(month, payCfg.cutoffDay);
  // Never derive a date that has not happened yet. The CURRENT month's window
  // runs to its cutoff, which for most of the month is in the future — and a
  // future workday has no check-in for the obvious reason, so iterating the
  // whole window would derive every remaining day as a full absence for every
  // employee. That is the default view of this page, so the clamp is not an
  // edge case. Bangkok, because that is the day the workforce is living in.
  // Yesterday, not today: a day is only assessable once it is OVER. Until then
  // "no check-in yet" is not absence — it is the morning. Read at 00:08 on
  // 2026-09-04 this page would otherwise have listed 47 of 48 employees as
  // absent for a day they were about to work.
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Bangkok',
  });
  const effectiveTo = to < yesterday ? to : yesterday;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${effectiveTo}T00:00:00.000Z`);

  const [employees, attendance, holidays, leaveRanges] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { in: ['Active', 'Probation'] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        baseSalary: true,
        salaryType: true,
        hiredAt: true,
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
    // Leave comes from approved LeaveRequest RANGES — the same source
    // payroll's run.ts uses — not from OnLeave attendance rows. The two are not
    // interchangeable: production has 33 dates with an approved request and no
    // OnLeave row. Every one is a Sunday, so the workday guard hides the
    // difference today, but that is a coincidence of the current schedules
    // (Mon–Sat). Schedule anyone on a Sunday and this page would start showing
    // absences payroll would never charge. Reading the same source removes the
    // whole class of divergence.
    prisma.leaveRequest.findMany({
      where: {
        status: 'Approved',
        deletedAt: null,
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const holidaySet = new Set(expandHolidaysWithSubstitutes(holidays.map((h) => h.date)).map(ymd));

  // Per employee, per date: what happened. Mirrors run.ts exactly — a check-in,
  // an admin-keyed Absent, or any approved leave. Durations are not needed:
  // any leave on a day exempts the whole day (see deriveAbsentMinutes).
  type DayFacts = { checkIn: boolean; manualAbsent: boolean };
  const facts = new Map<string, Map<string, DayFacts>>();
  const factFor = (empId: string, date: string): DayFacts => {
    let byDate = facts.get(empId);
    if (!byDate) {
      byDate = new Map();
      facts.set(empId, byDate);
    }
    let f = byDate.get(date);
    if (!f) {
      f = { checkIn: false, manualAbsent: false };
      byDate.set(date, f);
    }
    return f;
  };

  for (const a of attendance) {
    const f = factFor(a.employeeId, ymd(a.date));
    if (a.type === 'CheckIn') f.checkIn = true;
    else if (a.type === 'Absent') f.manualAbsent = true;
  }

  // Leave dates per employee, clamped to the window — same expansion run.ts
  // does. @db.Date values are UTC midnight, so stepping a day is exact.
  const leaveDatesByEmp = new Map<string, Set<string>>();
  for (const r of leaveRanges) {
    let set = leaveDatesByEmp.get(r.employeeId);
    if (!set) {
      set = new Set<string>();
      leaveDatesByEmp.set(r.employeeId, set);
    }
    const from = Math.max(r.startDate.getTime(), start.getTime());
    const to = Math.min(r.endDate.getTime(), end.getTime());
    for (let t = from; t <= to; t += 86_400_000) set.add(ymd(new Date(t)));
  }

  const rows: AbsencePreviewRow[] = [];
  let skippedNoSchedule = 0;
  let skippedNotChargeable = 0;

  for (const emp of employees) {
    // calcPayroll THROWS for any non-Monthly employee (PayrollCalcError, see
    // calc.ts), so a derived absence for one could never become a deduction.
    // Showing it would raise alarm about money that cannot move, and their
    // baseSalary is a day/hour RATE, so the salary column would mislead too.
    // Reusing payroll's own exported predicate rather than testing 'Monthly'
    // here, so the two can never disagree about who is in scope.
    if (!isPayrollChargeableSalaryType(emp.salaryType)) {
      skippedNotChargeable++;
      continue;
    }
    // Guard #2 from the design: with no schedule the system assumes Mon–Sat, so
    // deriving would charge a day's pay for every real day off. Refuse instead.
    if (!emp.workScheduleId || !emp.workSchedule) {
      skippedNoSchedule++;
      continue;
    }
    const minutesByDow = new Map<number, number>(
      emp.workSchedule.days.map((d) => [
        d.dayOfWeek,
        scheduledWorkMinutes(d.startTime, d.endTime, brk),
      ]),
    );
    const dows = [...minutesByDow.keys()];

    // Never derive a date before the employee existed. Found against production:
    // viewing July showed two employees absent for 25 days (฿12,500 each) when
    // they had been hired on 3 and 26 August — the whole window predated their
    // employment, and for one of them that exceeded his entire ฿12,000 salary.
    // There is no termination date on Employee; leavers are excluded by the
    // status filter above instead.
    const from = new Date(Math.max(start.getTime(), emp.hiredAt.getTime()));

    const days: AbsencePreviewDay[] = [];
    for (let t = from.getTime(); t <= end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const date = ymd(d);
      const dow = d.getUTCDay();
      const f = facts.get(emp.id)?.get(date);
      const minutes = deriveAbsentMinutes({
        scheduledMinutes: minutesByDow.get(dow) ?? 0,
        // Any leave exempts the day; 1 is a sentinel for "some leave".
        leaveMinutes: leaveDatesByEmp.get(emp.id)?.has(date) ? 1 : 0,
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
    // What was actually examined, not what the cutoff window spans — the page
    // says "งวด {from} – {to}", and claiming a range it did not inspect would
    // read as "nobody was absent after the 2nd" rather than "we have not looked
    // yet".
    to: effectiveTo,
    rows,
    standardDayMinutes: std,
    absentDeductionPerDay: Number(payCfg.absentDeductionPerDay),
    skippedNoSchedule,
    skippedNotChargeable,
  };
}
