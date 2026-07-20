/**
 * Writing a settlement is the ONLY way entitlement gets spent on a penalty.
 * Payroll never writes here — see penalty-settlement.ts for why that matters.
 *
 * Every guard below is enforced server-side even though the UI also prevents
 * it: the UI disables options for usability, this function is what makes them
 * impossible.
 */

'use server';

import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import type { PenaltyKindKey } from './penalty-settlement';

type Result = { ok: true } | { ok: false; error: string };

/** The leave year a pay-period month charges against: the year in its label.
 *  Stored on the row so no other reader re-derives it differently. */
function periodYearOf(month: string): number {
  return Number(month.slice(0, 4));
}

/** A month is closed once any payroll row for it has left Draft. Money is
 *  frozen then, but leave balance is always live — allowing an edit here would
 *  return the leave while the published slip keeps the money, and the two sides
 *  would disagree permanently with no way to reconcile them. */
async function isPeriodClosed(employeeId: string, month: string): Promise<boolean> {
  const row = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { not: 'Draft' } },
    select: { id: true },
  });
  return row != null;
}

export async function setPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
  leaveTypeId: string;
  days: number;
  note?: string;
}): Promise<Result> {
  const { user } = await requirePermission('payroll.run');

  if (!Number.isInteger(input.days) || input.days <= 0) {
    return { ok: false, error: 'invalid-days' };
  }
  if (await isPeriodClosed(input.employeeId, input.month)) {
    return { ok: false, error: 'period-closed' };
  }

  const leaveType = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    select: { penaltySettlementAllowed: true, archivedAt: true },
  });
  if (!leaveType || leaveType.archivedAt || !leaveType.penaltySettlementAllowed) {
    return { ok: false, error: 'leave-type-not-allowed' };
  }

  const year = periodYearOf(input.month);
  const std = standardDayMinutes(await getLeaveConfig());
  const minutes = input.days * std;

  const remaining = await remainingByTypeForEmployee(input.employeeId, year);
  const available = remaining[input.leaveTypeId];
  // null = unlimited quota. Spending from something with no ceiling is
  // meaningless, so it is refused rather than silently allowed.
  if (available == null) return { ok: false, error: 'leave-type-not-allowed' };

  // The row being replaced already counts against `available`; add it back so
  // editing 1 day to 2 days is judged on the true headroom, not on headroom
  // that already excludes the day being replaced. Only credited back when the
  // edit stays on the SAME leave type — switching types must not credit the
  // old type's minutes against the new type's balance.
  const existing = await prisma.attendancePenaltySettlement.findUnique({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    select: { minutes: true, leaveTypeId: true, deletedAt: true },
  });
  const creditBack =
    existing && !existing.deletedAt && existing.leaveTypeId === input.leaveTypeId
      ? existing.minutes
      : 0;

  if (minutes > available + creditBack) return { ok: false, error: 'insufficient-balance' };

  await prisma.attendancePenaltySettlement.upsert({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    create: {
      employeeId: input.employeeId,
      month: input.month,
      kind: input.kind,
      leaveTypeId: input.leaveTypeId,
      days: input.days,
      minutes,
      periodYear: year,
      note: input.note ?? null,
      createdById: user.id,
    },
    update: {
      leaveTypeId: input.leaveTypeId,
      days: input.days,
      minutes,
      periodYear: year,
      note: input.note ?? null,
      deletedAt: null,
    },
  });

  return { ok: true };
}

export async function clearPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<Result> {
  await requirePermission('payroll.run');

  if (await isPeriodClosed(input.employeeId, input.month)) {
    return { ok: false, error: 'period-closed' };
  }

  await prisma.attendancePenaltySettlement.updateMany({
    where: { employeeId: input.employeeId, month: input.month, kind: input.kind, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return { ok: true };
}
