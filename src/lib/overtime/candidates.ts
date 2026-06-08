import { prisma } from '@/lib/db/prisma';
import { overtimeMinutes } from './rate';

export type OtCandidate = {
  attendanceId: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  scheduledEnd: string; // HH:MM
  clockOut: string; // HH:MM
  minutesOver: number;
  /** Suggested rate from the employee's defaults (may be null). */
  defaultOtRateType: 'PerHourAmount' | 'Multiplier' | null;
  defaultOtRatePerHour: string | null;
  defaultOtMultiplier: string | null;
};

/** "HH:MM" of a Date in Asia/Bangkok. */
function hhmm(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Day-of-week (0=Sun..6=Sat) of a @db.Date value. A @db.Date is stored at UTC
 *  midnight, which is the same calendar day in Bangkok. */
function bangkokDow(date: Date): number {
  return date.getUTCDay();
}

/**
 * Live OT candidates for a month: CheckIn rows whose clock-out beat the
 * employee's scheduled end (for that weekday) by ≥ otThresholdMinutes, minus
 * any date that already has an OvertimeEntry (Approved or Rejected).
 */
export async function getOtCandidates(args: {
  ym: string; // "YYYY-MM"
  employeeId?: string;
}): Promise<OtCandidate[]> {
  const [yStr, mStr] = args.ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const cfg = await prisma.payrollConfig.findFirst({ select: { otThresholdMinutes: true } });
  const threshold = cfg?.otThresholdMinutes ?? 30;

  const rows = await prisma.attendance.findMany({
    where: {
      type: 'CheckIn',
      deletedAt: null,
      clockOutAt: { not: null },
      date: { gte: start, lt: end },
      ...(args.employeeId ? { employeeId: args.employeeId } : {}),
    },
    select: {
      id: true,
      employeeId: true,
      date: true,
      clockOutAt: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          defaultOtRateType: true,
          defaultOtRatePerHour: true,
          defaultOtMultiplier: true,
          workSchedule: { select: { days: { select: { dayOfWeek: true, endTime: true } } } },
        },
      },
    },
  });

  // Existing decisions (Approved or Rejected, non-deleted) to exclude.
  const decided = await prisma.overtimeEntry.findMany({
    where: {
      date: { gte: start, lt: end },
      deletedAt: null,
      ...(args.employeeId ? { employeeId: args.employeeId } : {}),
    },
    select: { employeeId: true, date: true },
  });
  const decidedKey = new Set(
    decided.map((d) => `${d.employeeId}:${d.date.toISOString().slice(0, 10)}`),
  );

  const out: OtCandidate[] = [];
  for (const r of rows) {
    if (!r.clockOutAt) continue;
    const sched = r.employee.workSchedule?.days.find((d) => d.dayOfWeek === bangkokDow(r.date));
    if (!sched) continue; // no scheduled end → can't detect OT
    const clockOut = hhmm(r.clockOutAt);
    const over = overtimeMinutes(sched.endTime, clockOut);
    if (over < threshold) continue;
    const dateStr = r.date.toISOString().slice(0, 10);
    if (decidedKey.has(`${r.employeeId}:${dateStr}`)) continue;
    const e = r.employee;
    out.push({
      attendanceId: r.id,
      employeeId: r.employeeId,
      employeeName: e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim(),
      date: dateStr,
      scheduledEnd: sched.endTime,
      clockOut,
      minutesOver: over,
      defaultOtRateType: e.defaultOtRateType,
      defaultOtRatePerHour: e.defaultOtRatePerHour ? String(e.defaultOtRatePerHour) : null,
      defaultOtMultiplier: e.defaultOtMultiplier ? String(e.defaultOtMultiplier) : null,
    });
  }
  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.employeeName.localeCompare(b.employeeName),
  );
  return out;
}
