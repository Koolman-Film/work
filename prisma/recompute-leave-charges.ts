/**
 * Recompute leave charges + over-quota deductions for APPROVED leave, to make
 * the frozen snapshot (chargedMinutes / overQuotaMinutes / deductAmount) match
 * the CURRENT entitlement.
 *
 * Why: the over-quota deduction is frozen at approval; if an admin later edits
 * the leave entitlement, the live "remaining" shifts but the frozen deduction
 * does not, so the report looks inconsistent. This recomputes them as a batch.
 *
 * What it does, per (employee, leave type, year), for DeductPay types only:
 *   1. Fills chargedMinutes where null (segment.minutes × working-days, exactly
 *      like approval — Sundays + holidays excluded).
 *   2. Replays over-quota IN APPROVAL ORDER against the current entitlement
 *      (earlier requests consume the quota first) → new overQuotaMinutes +
 *      deductAmount.
 *
 * SAFETY:
 *   - Requests already swept into a payroll (deductedInPayrollId set) are NEVER
 *     modified — but they DO consume the quota first (their charge is part of
 *     the baseline), so un-swept requests are measured against what's left.
 *   - Block-policy types are skipped (they don't deduct).
 *   - --dry-run prints the before→after diff and writes nothing. ALWAYS run
 *     --dry-run first and review, especially before publishing payroll.
 *
 * Run (dry):  pnpm exec dotenv -e .env.local -- tsx prisma/recompute-leave-charges.ts --dry-run
 * Run (apply): pnpm exec dotenv -e .env.local -- tsx prisma/recompute-leave-charges.ts
 */

// biome-ignore-all lint/suspicious/noConsole: one-off CLI script — console is the output channel

import { PrismaClient } from '@prisma/client';
import { perMinuteRate, replayOverQuota } from '../src/lib/leave/over-quota';
import { segmentFor, standardDayMinutes } from '../src/lib/leave/units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '../src/lib/leave/working-days';

const DRY_RUN = process.argv.includes('--dry-run');
const prisma = new PrismaClient();

const CFG_FALLBACK = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

function fmt(n: number | null): string {
  return n == null ? '—' : String(n);
}

async function main() {
  console.log(DRY_RUN ? '— DRY RUN — no rows will be written —\n' : '— APPLYING CHANGES —\n');

  const cfg = (await prisma.leaveConfig.findFirst()) ?? CFG_FALLBACK;
  const std = standardDayMinutes(cfg);
  const payCfg = await prisma.payrollConfig.findFirstOrThrow({
    select: { workingDaysPerMonth: true },
  });
  const holidayRows = await prisma.holiday.findMany({
    where: { archivedAt: null },
    select: { date: true },
  });
  const allHolidays = holidayRows.map((h) => h.date);

  // Approved DeductPay leave, ordered so we can group by (emp, type) and replay
  // in approval order within each group.
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
      employee: {
        select: { salaryType: true, baseSalary: true, nickname: true, firstName: true },
      },
      leaveType: { select: { name: true, annualQuota: true } },
    },
  });

  // chargedMinutes (fill nulls) — exactly like backfill-leave-charged.
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
    const year = r.startDate.getUTCFullYear();
    const key = `${r.employeeId}:${r.leaveTypeId}:${year}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let chargedFilled = 0;
  let deductChanged = 0;
  const updates: Array<{
    id: string;
    chargedMinutes: number;
    overQuotaMinutes: number;
    deductAmount: number | null;
  }> = [];

  for (const [key, g] of groups) {
    const [employeeId, leaveTypeId, yearStr] = key.split(':');
    const year = Number(yearStr);
    const sample = g[0];
    if (!sample) continue;

    const ent = await prisma.leaveEntitlement.findUnique({
      where: {
        employeeId_leaveTypeId_periodYear: {
          employeeId: employeeId as string,
          leaveTypeId: leaveTypeId as string,
          periodYear: year,
        },
      },
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

    // Approval order so over-quota accrues the way it did originally.
    const ordered = [...g].sort(
      (a, b) => (a.reviewedAt ?? a.createdAt).getTime() - (b.reviewedAt ?? b.createdAt).getTime(),
    );
    const results = replayOverQuota(
      {
        grantedMinutes,
        carryoverMinutes: ent?.carryoverMinutes ?? 0,
        adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
      },
      ordered.map((r) => ({ id: r.id, chargedMinutes: charged.get(r.id) ?? 0 })),
      rate,
    );
    const resById = new Map(results.map((x) => [x.id, x]));

    for (const r of ordered) {
      const newCharged = charged.get(r.id) ?? 0;
      const res = resById.get(r.id);
      if (!res) continue;
      const oldDeduct = r.deductAmount == null ? null : Number(r.deductAmount);
      const chargedNowFilled = r.chargedMinutes == null;
      const changed =
        chargedNowFilled ||
        (r.overQuotaMinutes ?? 0) !== res.overQuotaMinutes ||
        oldDeduct !== res.deductAmount;

      if (chargedNowFilled) chargedFilled++;

      if (r.deductedInPayrollId) {
        // Locked into a payroll — never touch, but it already consumed quota.
        if (changed) {
          console.log(
            `  SKIP (swept) ${sample.employee.nickname ?? sample.employee.firstName} · ${sample.leaveType.name} · ${r.startDate.toISOString().slice(0, 10)} — frozen in payroll`,
          );
        }
        continue;
      }

      if (changed) {
        if ((r.overQuotaMinutes ?? 0) !== res.overQuotaMinutes || oldDeduct !== res.deductAmount) {
          deductChanged++;
        }
        console.log(
          `  ${sample.employee.nickname ?? sample.employee.firstName} · ${sample.leaveType.name} · ${r.startDate.toISOString().slice(0, 10)}: ` +
            `charged ${fmt(r.chargedMinutes)}→${newCharged}, over ${fmt(r.overQuotaMinutes)}→${res.overQuotaMinutes}, deduct ${fmt(oldDeduct)}→${fmt(res.deductAmount)}`,
        );
        updates.push({
          id: r.id,
          chargedMinutes: newCharged,
          overQuotaMinutes: res.overQuotaMinutes,
          deductAmount: res.deductAmount,
        });
      }
    }
  }

  if (!DRY_RUN) {
    for (const u of updates) {
      await prisma.leaveRequest.update({
        where: { id: u.id },
        data: {
          chargedMinutes: u.chargedMinutes,
          overQuotaMinutes: u.overQuotaMinutes,
          deductAmount: u.deductAmount,
        },
      });
    }
  }

  console.log(`\nApproved DeductPay leave rows scanned: ${rows.length}`);
  console.log(`  chargedMinutes filled (were null): ${chargedFilled}`);
  console.log(`  over-quota / deduction changed:    ${deductChanged}`);
  console.log(`  total rows ${DRY_RUN ? 'that WOULD be' : ''} updated: ${updates.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
