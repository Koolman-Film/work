/**
 * Writing a settlement is the ONLY way entitlement gets spent on a penalty.
 * Payroll never writes here — see penalty-settlement.ts for why that matters.
 *
 * Every guard below is enforced server-side even though the UI also prevents
 * it: the UI disables options for usability, this function is what makes them
 * impossible.
 */

'use server';

import { auditLogTx } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import { lockPayrollMonth } from './month-lock';
import type { PenaltyKindKey } from './penalty-settlement';

type Result = { ok: true } | { ok: false; error: string };

/** Transaction client compatible with both the extended `prisma` client and a
 *  plain `Prisma.TransactionClient`. Mirrors the pattern in leave/balance.ts
 *  and leave/penalty-minutes.ts. */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Malformed input must return `{ ok: false }` like every other guard here,
// not let Postgres throw `invalid input syntax for type uuid` for a
// `@db.Uuid` column and reject the whole action (Finding 2 of the review
// that added the advisory lock). Same pattern as UUID_RE in
// admin/payroll/actions.ts and the other admin routes that validate an id
// before it reaches a typed Prisma query against a Uuid column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The leave year a pay-period month charges against: the year in its label.
 *  Stored on the row so no other reader re-derives it differently. */
function periodYearOf(month: string): number {
  return Number(month.slice(0, 4));
}

/** A month is closed once any payroll row for it has left Draft. Money is
 *  frozen then, but leave balance is always live — allowing an edit here would
 *  return the leave while the published slip keeps the money, and the two sides
 *  would disagree permanently with no way to reconcile them.
 *
 *  Takes the active transaction client (defaults to `prisma` for read-only
 *  callers) so it participates in the advisory lock taken by
 *  `lockPayrollMonth` (./month-lock.ts) — see that module's comment for why
 *  this must run AFTER the lock, inside the same transaction, rather than as
 *  a standalone read. */
async function isPeriodClosed(
  employeeId: string,
  month: string,
  db: TxClient = prisma,
): Promise<boolean> {
  const row = await db.payroll.findFirst({
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
  if (!MONTH_RE.test(input.month)) {
    return { ok: false, error: 'invalid-month' };
  }
  if (!UUID_RE.test(input.employeeId)) {
    return { ok: false, error: 'invalid-employee' };
  }

  // Everything from the lock through the upsert runs in one transaction so
  // the "is this month still open" guard and the write it protects can never
  // be split by a concurrent publish or a concurrent settlement on another
  // penalty kind for the same employee/month — see month-lock.ts's comment.
  return prisma.$transaction(async (tx) => {
    await lockPayrollMonth(tx, input.month);

    if (await isPeriodClosed(input.employeeId, input.month, tx)) {
      return { ok: false, error: 'period-closed' };
    }

    const leaveType = await tx.leaveType.findUnique({
      where: { id: input.leaveTypeId },
      select: { penaltySettlementAllowed: true, archivedAt: true },
    });
    if (!leaveType || leaveType.archivedAt || !leaveType.penaltySettlementAllowed) {
      return { ok: false, error: 'leave-type-not-allowed' };
    }

    const year = periodYearOf(input.month);
    const std = standardDayMinutes(await getLeaveConfig());
    const minutes = input.days * std;

    const remaining = await remainingByTypeForEmployee(input.employeeId, year, tx);
    const available = remaining[input.leaveTypeId];
    // null = unlimited quota. Spending from something with no ceiling is
    // meaningless, so it is refused rather than silently allowed.
    if (available == null) return { ok: false, error: 'leave-type-not-allowed' };

    // The row being replaced already counts against `available`; add it back
    // so editing 1 day to 2 days is judged on the true headroom, not on
    // headroom that already excludes the day being replaced. Only credited
    // back when the edit stays on the SAME leave type — switching types must
    // not credit the old type's minutes against the new type's balance.
    const existing = await tx.attendancePenaltySettlement.findUnique({
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

    const row = await tx.attendancePenaltySettlement.upsert({
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

    // A soft-deleted row is not "live" — resurrecting it (clear, then settle
    // again) is a fresh settlement, not an edit of the values that used to be
    // there. Classify strictly on a LIVE existing row so the audit trail
    // doesn't read as `penaltySettlement.update` with a `before` block full
    // of values that were already cleared. The credit-back math above already
    // makes this same distinction (`!existing.deletedAt`) for the balance —
    // this mirrors it for the audit decision only.
    const existingLive = existing && !existing.deletedAt ? existing : null;

    // Reached only after every guard above has already passed — a refused
    // call (period-closed / leave-type-not-allowed / insufficient-balance /
    // invalid-days / invalid-month) never reaches here, so no audit row is
    // written for it. Logged here (not in the reconcile page's wrapper)
    // because this action is called from two surfaces — the manual
    // attendance form and the payroll reconcile page — and auditing at the
    // source covers both by construction. Written via `auditLogTx` (not the
    // fire-and-forget `auditLog`) so the audit row commits or rolls back with
    // the settlement it describes, inside the same locked transaction.
    await auditLogTx(tx, {
      actorId: user.id,
      action: existingLive ? 'penaltySettlement.update' : 'penaltySettlement.create',
      entityType: 'AttendancePenaltySettlement',
      entityId: row.id,
      before: existingLive
        ? {
            employeeId: input.employeeId,
            month: input.month,
            kind: input.kind,
            leaveTypeId: existingLive.leaveTypeId,
            days: existingLive.days.toNumber(),
            minutes: existingLive.minutes,
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
  });
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

  if (!MONTH_RE.test(input.month)) {
    return { ok: false, error: 'invalid-month' };
  }
  if (!UUID_RE.test(input.employeeId)) {
    return { ok: false, error: 'invalid-employee' };
  }

  // Same lock + transaction reasoning as setPenaltySettlement: the guard and
  // the write it protects must not be split by a concurrent publish or a
  // concurrent settlement on another kind for this employee/month.
  return prisma.$transaction(async (tx) => {
    await lockPayrollMonth(tx, input.month);

    if (await isPeriodClosed(input.employeeId, input.month, tx)) {
      return { ok: false, error: 'period-closed' };
    }

    // Snapshot the live row before clearing so the audit entry can carry what
    // it said — `updateMany`'s `count` (below) is what actually tells us
    // whether anything was cleared, since this row may already be gone.
    const existing = await tx.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: {
          employeeId: input.employeeId,
          month: input.month,
          kind: input.kind,
        },
      },
      select: { id: true, days: true, minutes: true, leaveTypeId: true },
    });

    const result = await tx.attendancePenaltySettlement.updateMany({
      where: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    // Only log when a row was actually cleared — `updateMany` matches zero
    // rows when there was nothing live to clear, and an unconditional log
    // would claim a change that never happened. `updateMany`'s own
    // `deletedAt: null` filter means a `count > 0` row was live, so `existing`
    // here (found by the same key, in the same transaction) can't be a stale
    // soft-deleted snapshot.
    if (result.count > 0 && existing) {
      await auditLogTx(tx, {
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
  });
}
