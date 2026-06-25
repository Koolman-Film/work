/**
 * Live leave-charge computation — the single source of truth for a leave's
 * chargedMinutes / overQuotaMinutes / deductAmount.
 *
 * The over-quota deduction is a DERIVED value (it depends on the current
 * entitlement + year-to-date usage + approval order). Storing it frozen at
 * approval lets it drift when the entitlement is later edited. So instead we
 * compute it live everywhere it's read (report, payroll draft), and only the
 * payroll PUBLISH step freezes it (once it's been paid, it must never move).
 *
 * `computeLiveLeaveCharges` returns, per approved DeductPay leave:
 *   - the live value to USE: recomputed for un-paid leave, but the FROZEN value
 *     for leave already swept into a published payroll (paid = locked).
 *   - the current DB snapshot, so callers (the maintenance tool) can diff.
 *
 * The money-critical math is the unit-tested `replayOverQuota`.
 */

import { prisma } from '@/lib/db/prisma';
import { perMinuteRate, replayOverQuota } from './over-quota';
import { segmentFor, standardDayMinutes } from './units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from './working-days';

export type LiveLeaveCharge = {
  leaveRequestId: string;
  employeeId: string;
  leaveTypeId: string;
  employeeName: string;
  leaveTypeName: string;
  /** startDate YYYY-MM-DD. */
  date: string;
  startDate: Date;
  /** Current frozen DB snapshot. */
  curChargedMinutes: number | null;
  curOverMinutes: number;
  curDeduct: number | null;
  /** Value to USE: live for un-paid leave, frozen for paid (swept) leave. */
  chargedMinutes: number;
  overQuotaMinutes: number;
  deductAmount: number | null;
  /** Already swept into a published payroll → locked, never recomputed. */
  swept: boolean;
};

const CFG_FALLBACK = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

/**
 * Compute the correct (live) charge/over-quota/deduction for every approved
 * DeductPay leave, optionally scoped to `employeeIds`. Read-only.
 */
export async function computeLiveLeaveCharges(
  employeeIds?: readonly string[],
): Promise<LiveLeaveCharge[]> {
  const cfg = (await prisma.leaveConfig.findFirst()) ?? CFG_FALLBACK;
  const std = standardDayMinutes(cfg);
  const payCfg = await prisma.payrollConfig.findFirstOrThrow({
    select: { workingDaysPerMonth: true },
  });
  const allHolidays = (
    await prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } })
  ).map((h) => h.date);

  const rows = await prisma.leaveRequest.findMany({
    where: {
      status: 'Approved',
      deletedAt: null,
      leaveType: { overQuotaPolicy: 'DeductPay' },
      ...(employeeIds ? { employeeId: { in: [...employeeIds] } } : {}),
    },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      endDate: true,
      unit: true,
      startTime: true,
      endTime: true,
      chargedMinutes: true,
      overQuotaMinutes: true,
      deductAmount: true,
      reviewedAt: true,
      createdAt: true,
      deductedInPayrollId: true,
      employee: { select: { salaryType: true, baseSalary: true, nickname: true, firstName: true } },
      leaveType: { select: { name: true, annualQuota: true } },
    },
  });

  // chargedMinutes (factual; fill nulls like approval / backfill).
  const charged = new Map<string, number>();
  for (const r of rows) {
    if (r.chargedMinutes != null) {
      charged.set(r.id, r.chargedMinutes);
      continue;
    }
    const segment = segmentFor(r.unit, cfg, r.startTime, r.endTime);
    if (!segment) {
      charged.set(r.id, 0);
      continue;
    }
    const dayBeforeStart = new Date(r.startDate.getTime() - 86_400_000);
    const inWindow = allHolidays.filter(
      (d) => d.getTime() >= dayBeforeStart.getTime() && d.getTime() <= r.endDate.getTime(),
    );
    charged.set(
      r.id,
      segment.minutes *
        workingDaysIn({
          startDate: r.startDate,
          endDate: r.endDate,
          holidays: expandHolidaysWithSubstitutes(inWindow),
        }).length,
    );
  }

  // Group by employee:type:year so over-quota replays per entitlement window.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.employeeId}:${r.leaveTypeId}:${r.startDate.getUTCFullYear()}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: LiveLeaveCharge[] = [];
  for (const [key, g] of groups) {
    const parts = key.split(':');
    const employeeId = parts[0] ?? '';
    const leaveTypeId = parts[1] ?? '';
    const year = Number(parts[2]);
    const sample = g[0];
    if (!sample) continue;

    const ent = await prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveTypeId_periodYear: { employeeId, leaveTypeId, periodYear: year } },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    });
    const grantedMinutes = ent
      ? ent.grantedMinutes
      : sample.leaveType.annualQuota == null
        ? null
        : sample.leaveType.annualQuota * std;
    const rate = perMinuteRate(
      sample.employee.salaryType,
      Number(sample.employee.baseSalary),
      payCfg.workingDaysPerMonth,
      std,
    );

    // Approval order: earlier requests consume the quota first.
    const ordered = [...g].sort(
      (a, b) => (a.reviewedAt ?? a.createdAt).getTime() - (b.reviewedAt ?? b.createdAt).getTime(),
    );
    const replayed = new Map(
      replayOverQuota(
        {
          grantedMinutes,
          carryoverMinutes: ent?.carryoverMinutes ?? 0,
          adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
        },
        ordered.map((r) => ({ id: r.id, chargedMinutes: charged.get(r.id) ?? 0 })),
        rate,
      ).map((x) => [x.id, x]),
    );

    for (const r of ordered) {
      const live = replayed.get(r.id);
      if (!live) continue;
      const newCharged = charged.get(r.id) ?? 0;
      const curOver = r.overQuotaMinutes ?? 0;
      const curDeduct = r.deductAmount == null ? null : Number(r.deductAmount);
      const swept = r.deductedInPayrollId != null;
      out.push({
        leaveRequestId: r.id,
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        employeeName: sample.employee.nickname ?? sample.employee.firstName,
        leaveTypeName: sample.leaveType.name,
        date: r.startDate.toISOString().slice(0, 10),
        startDate: r.startDate,
        curChargedMinutes: r.chargedMinutes,
        curOverMinutes: curOver,
        curDeduct,
        chargedMinutes: newCharged,
        // Paid leave is locked to its frozen value; un-paid uses the live replay.
        overQuotaMinutes: swept ? curOver : live.overQuotaMinutes,
        deductAmount: swept ? curDeduct : live.deductAmount,
        swept,
      });
    }
  }
  return out;
}

export type LeaveChargeChange = {
  leaveRequestId: string;
  employeeName: string;
  leaveTypeName: string;
  date: string;
  oldChargedMinutes: number | null;
  newChargedMinutes: number;
  oldOverMinutes: number;
  newOverMinutes: number;
  oldDeduct: number | null;
  newDeduct: number | null;
  swept: boolean;
};

export type RecomputeResult = {
  scanned: number;
  changes: LeaveChargeChange[];
  applied: number;
};

/**
 * Maintenance tool: persist the live values onto the stored snapshot (so the
 * frozen DB fields stop being stale). With derive-on-read this is now just a
 * cache refresh — the report/payroll are already correct without it. Paid
 * (swept) rows are never written. apply=false → dry run.
 */
export async function recomputeLeaveCharges(opts: { apply: boolean }): Promise<RecomputeResult> {
  const live = await computeLiveLeaveCharges();
  const changes: LeaveChargeChange[] = [];
  const toApply: Array<{ id: string; charged: number; over: number; deduct: number | null }> = [];

  for (const c of live) {
    const differs =
      c.curChargedMinutes == null ||
      c.curOverMinutes !== c.overQuotaMinutes ||
      c.curDeduct !== c.deductAmount;
    if (!differs) continue;
    changes.push({
      leaveRequestId: c.leaveRequestId,
      employeeName: c.employeeName,
      leaveTypeName: c.leaveTypeName,
      date: c.date,
      oldChargedMinutes: c.curChargedMinutes,
      newChargedMinutes: c.chargedMinutes,
      oldOverMinutes: c.curOverMinutes,
      newOverMinutes: c.overQuotaMinutes,
      oldDeduct: c.curDeduct,
      newDeduct: c.deductAmount,
      swept: c.swept,
    });
    if (!c.swept) {
      toApply.push({
        id: c.leaveRequestId,
        charged: c.chargedMinutes,
        over: c.overQuotaMinutes,
        deduct: c.deductAmount,
      });
    }
  }

  let applied = 0;
  if (opts.apply && toApply.length > 0) {
    await prisma.$transaction(
      toApply.map((u) =>
        prisma.leaveRequest.update({
          where: { id: u.id },
          data: { chargedMinutes: u.charged, overQuotaMinutes: u.over, deductAmount: u.deduct },
        }),
      ),
    );
    applied = toApply.length;
  }

  changes.sort(
    (a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date),
  );
  return { scanned: live.length, changes, applied };
}
