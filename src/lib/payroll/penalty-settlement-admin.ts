/**
 * Writing a settlement is the ONLY way entitlement gets spent on a penalty.
 * Payroll never writes here — see penalty-settlement.ts for why that matters.
 *
 * Every guard below is enforced server-side even though the UI also prevents
 * it: the UI disables options for usability, this function is what makes them
 * impossible.
 */

'use server';

import { auditLog } from '@/lib/audit/log';
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
    select: { id: true, days: true, minutes: true, leaveTypeId: true, deletedAt: true },
  });
  const creditBack =
    existing && !existing.deletedAt && existing.leaveTypeId === input.leaveTypeId
      ? existing.minutes
      : 0;

  if (minutes > available + creditBack) return { ok: false, error: 'insufficient-balance' };

  const row = await prisma.attendancePenaltySettlement.upsert({
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

  // Reached only after every guard above has already passed — a refused
  // call (period-closed / leave-type-not-allowed / insufficient-balance /
  // invalid-days) never reaches here, so no audit row is written for it.
  // Logged here (not in the reconcile page's wrapper) because this action is
  // called from two surfaces — the manual attendance form and the payroll
  // reconcile page — and auditing at the source covers both by construction.
  auditLog({
    actorId: user.id,
    action: existing ? 'penaltySettlement.update' : 'penaltySettlement.create',
    entityType: 'AttendancePenaltySettlement',
    entityId: row.id,
    before: existing
      ? {
          employeeId: input.employeeId,
          month: input.month,
          kind: input.kind,
          leaveTypeId: existing.leaveTypeId,
          days: existing.days.toNumber(),
          minutes: existing.minutes,
        }
      : undefined,
    after: {
      employeeId: input.employeeId,
      month: input.month,
      kind: input.kind,
      leaveTypeId: input.leaveTypeId,
      days: input.days,
      minutes,
    },
    metadata: { source: 'server-action' },
  });

  return { ok: true };
}

/** Current live settlement for (employeeId, month, kind), or null when none
 *  exists (never written, or soft-deleted). Read-only — used so the manual
 *  attendance form can warn before a second call to `setPenaltySettlement`
 *  silently replaces the first (the upsert is keyed on employeeId+month+kind,
 *  so a second "หักสิทธิ" pick for the same month overwrites rather than
 *  adds). Does not write anything; `setPenaltySettlement`/
 *  `clearPenaltySettlement` remain the only writers of this table. */
export async function getPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<{ days: number; leaveTypeName: string } | null> {
  await requirePermission('payroll.run');

  const row = await prisma.attendancePenaltySettlement.findUnique({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    select: { days: true, deletedAt: true, leaveType: { select: { name: true } } },
  });
  if (!row || row.deletedAt) return null;

  return { days: row.days.toNumber(), leaveTypeName: row.leaveType.name };
}

/** Remaining whole days per penalty-eligible leave type, for the payroll year
 *  that owns `month` — the exact year `setPenaltySettlement` enforces its
 *  balance check against. Read-only; used by the manual attendance form's
 *  preview so a backdated entry that crosses a payroll-year boundary shows
 *  the same balance the server will check, instead of today's calendar year. */
export async function getPenaltyLeaveBalance(input: {
  employeeId: string;
  month: string;
}): Promise<Record<string, number>> {
  await requirePermission('payroll.run');

  const year = periodYearOf(input.month);
  const std = standardDayMinutes(await getLeaveConfig());
  const remaining = await remainingByTypeForEmployee(input.employeeId, year);

  const days: Record<string, number> = {};
  for (const [leaveTypeId, minutes] of Object.entries(remaining)) {
    // null = unlimited quota, which is not selectable — report 0 so the
    // option renders disabled rather than appearing to offer infinite
    // headroom (setPenaltySettlement refuses it either way).
    days[leaveTypeId] = minutes == null ? 0 : Math.floor(minutes / std);
  }
  return days;
}

export async function clearPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<Result> {
  const { user } = await requirePermission('payroll.run');

  if (await isPeriodClosed(input.employeeId, input.month)) {
    return { ok: false, error: 'period-closed' };
  }

  // Snapshot the live row before clearing so the audit entry can carry what
  // it said — `updateMany`'s `count` (below) is what actually tells us
  // whether anything was cleared, since this row may already be gone.
  const existing = await prisma.attendancePenaltySettlement.findUnique({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    select: { id: true, days: true, minutes: true, leaveTypeId: true },
  });

  const result = await prisma.attendancePenaltySettlement.updateMany({
    where: { employeeId: input.employeeId, month: input.month, kind: input.kind, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  // Only log when a row was actually cleared — `updateMany` matches zero
  // rows when there was nothing live to clear, and an unconditional log
  // would claim a change that never happened.
  if (result.count > 0 && existing) {
    auditLog({
      actorId: user.id,
      action: 'penaltySettlement.clear',
      entityType: 'AttendancePenaltySettlement',
      entityId: existing.id,
      before: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
        leaveTypeId: existing.leaveTypeId,
        days: existing.days.toNumber(),
        minutes: existing.minutes,
      },
      after: { cleared: true },
      metadata: { source: 'server-action' },
    });
  }

  return { ok: true };
}
