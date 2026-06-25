/**
 * Recompute leave charges + over-quota deductions for APPROVED DeductPay leave,
 * so the frozen snapshot (chargedMinutes / overQuotaMinutes / deductAmount)
 * matches the CURRENT entitlement.
 *
 * Shared by the admin maintenance tool (server action) and the CLI script.
 * The money-critical math is the unit-tested `replayOverQuota`.
 *
 * Per (employee, leaveType, year):
 *   1. Fills chargedMinutes where null (segment × working-days, like approval).
 *   2. Replays over-quota in APPROVAL ORDER against the current entitlement
 *      (earlier requests consume the quota first).
 *
 * SAFETY: requests already swept into a payroll (deductedInPayrollId set) are
 * NEVER modified — but they DO consume the quota first (baseline), so un-swept
 * requests are measured against what's left.
 */

import { prisma } from '@/lib/db/prisma';
import { perMinuteRate, replayOverQuota } from './over-quota';
import { segmentFor, standardDayMinutes } from './units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from './working-days';

export type LeaveChargeChange = {
  leaveRequestId: string;
  employeeName: string;
  leaveTypeName: string;
  /** startDate YYYY-MM-DD. */
  date: string;
  oldChargedMinutes: number | null;
  newChargedMinutes: number;
  oldOverMinutes: number;
  newOverMinutes: number;
  oldDeduct: number | null;
  newDeduct: number | null;
  /** Already in a payroll → shown for transparency but NOT applied. */
  swept: boolean;
};

export type RecomputeResult = {
  scanned: number;
  /** Rows whose snapshot differs from the recomputed value (incl. swept). */
  changes: LeaveChargeChange[];
  /** Rows actually written (0 when dry-run). */
  applied: number;
};

const CFG_FALLBACK = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

/** Recompute and (optionally) apply. apply=false → dry-run, writes nothing. */
export async function recomputeLeaveCharges(opts: { apply: boolean }): Promise<RecomputeResult> {
  const cfg = (await prisma.leaveConfig.findFirst()) ?? CFG_FALLBACK;
  const std = standardDayMinutes(cfg);
  const payCfg = await prisma.payrollConfig.findFirstOrThrow({
    select: { workingDaysPerMonth: true },
  });
  const allHolidays = (
    await prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } })
  ).map((h) => h.date);

  const rows = await prisma.leaveRequest.findMany({
    where: { status: 'Approved', deletedAt: null, leaveType: { overQuotaPolicy: 'DeductPay' } },
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

  // chargedMinutes (fill nulls) — same logic as approval / backfill.
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
    const workingDays = workingDaysIn({
      startDate: r.startDate,
      endDate: r.endDate,
      holidays: expandHolidaysWithSubstitutes(inWindow),
    });
    charged.set(r.id, segment.minutes * workingDays.length);
  }

  // Group by employee:type:year.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.employeeId}:${r.leaveTypeId}:${r.startDate.getUTCFullYear()}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const changes: LeaveChargeChange[] = [];
  const toApply: Array<{ id: string; charged: number; over: number; deduct: number | null }> = [];

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

    const ordered = [...g].sort(
      (a, b) => (a.reviewedAt ?? a.createdAt).getTime() - (b.reviewedAt ?? b.createdAt).getTime(),
    );
    const resById = new Map(
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
      const res = resById.get(r.id);
      if (!res) continue;
      const newCharged = charged.get(r.id) ?? 0;
      const oldDeduct = r.deductAmount == null ? null : Number(r.deductAmount);
      const differs =
        r.chargedMinutes == null ||
        (r.overQuotaMinutes ?? 0) !== res.overQuotaMinutes ||
        oldDeduct !== res.deductAmount;
      if (!differs) continue;

      changes.push({
        leaveRequestId: r.id,
        employeeName: sample.employee.nickname ?? sample.employee.firstName,
        leaveTypeName: sample.leaveType.name,
        date: r.startDate.toISOString().slice(0, 10),
        oldChargedMinutes: r.chargedMinutes,
        newChargedMinutes: newCharged,
        oldOverMinutes: r.overQuotaMinutes ?? 0,
        newOverMinutes: res.overQuotaMinutes,
        oldDeduct,
        newDeduct: res.deductAmount,
        swept: r.deductedInPayrollId != null,
      });
      if (r.deductedInPayrollId == null) {
        toApply.push({
          id: r.id,
          charged: newCharged,
          over: res.overQuotaMinutes,
          deduct: res.deductAmount,
        });
      }
    }
  }

  let applied = 0;
  if (opts.apply && toApply.length > 0) {
    await prisma.$transaction(
      toApply.map((u) =>
        prisma.leaveRequest.update({
          where: { id: u.id },
          data: {
            chargedMinutes: u.charged,
            overQuotaMinutes: u.over,
            deductAmount: u.deduct,
          },
        }),
      ),
    );
    applied = toApply.length;
  }

  changes.sort(
    (a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date),
  );
  return { scanned: rows.length, changes, applied };
}
