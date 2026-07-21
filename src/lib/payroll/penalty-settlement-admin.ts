/**
 * Writing a settlement is the ONLY way entitlement gets spent on a penalty.
 * Payroll never writes here — see penalty-settlement.ts for why that matters.
 *
 * Every guard below is enforced server-side even though the UI also prevents
 * it: the UI disables options for usability, this function is what makes them
 * impossible.
 */

'use server';

import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { lockEntitlement, remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import { isPayrollChargeableSalaryType, type SalaryType } from './calc';
import { lockPayrollMonth, withMonthLockRetry } from './month-lock';
import type { PenaltyKindKey } from './penalty-settlement';
import { actualPenaltyDaysForEmployee } from './run';

type Result = { ok: true } | { ok: false; error: string };

/** `withMonthLockRetry`'s busy predicate for this module's `Result` shape. */
function isBusyResult(result: Result): boolean {
  return !result.ok && result.error === 'busy';
}

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
  /** Which surface called this — the manual attendance form's one-off entry
   *  flow, or the payroll reconcile page's per-row editor. Recorded on the
   *  audit entry, same discriminator payroll/actions.ts records for its own
   *  writes, so a disputed settlement's audit trail says where it came from
   *  without guessing from the (employeeId, month, kind) key alone. */
  via: 'manual-attendance' | 'reconcile';
}): Promise<Result> {
  // B-payroll-guard Layer 1: payroll permissions may only ever be exercised
  // GLOBALLY. A bare permission check (no branch-scope requirement) would
  // admit a branch-scoped grant (e.g. the system Admin role, which is
  // intentionally allowed to be branch-scoped — see team-guards.ts) and let
  // that actor settle/enumerate any employee in any branch, since nothing
  // else in this function is branch-aware (the month-wide advisory lock and
  // runPayrollDraft recompute the WHOLE month, not one employee).
  const { user } = await requireGlobalPermission('payroll.run');

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

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
  // Wrapped in a couple of short retries (withMonthLockRetry above): this
  // transaction is quick (one employee, a handful of point reads/writes), so
  // losing the lock race once doesn't mean losing it again a moment later —
  // an admin having to manually retry a routine save is worse than that.
  return withMonthLockRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // Non-blocking: `false` means another publish/draft/settlement
        // transaction holds this month's lock right now. Return `busy` (not a
        // throw) so the retry above, and ultimately the caller, can treat it
        // the same way as every other refusal here instead of an unhandled
        // rejection.
        if (!(await lockPayrollMonth(tx, input.month))) {
          return { ok: false, error: 'busy' };
        }

        if (await isPeriodClosed(input.employeeId, input.month, tx)) {
          return { ok: false, error: 'period-closed' };
        }

        // Defect 1: refuse for a salary type payroll can never charge a money
        // penalty for in the first place (V1 scope is Monthly only — see
        // calc.ts). Settling such an employee would spend real leave
        // entitlement forgiving a penalty that would never have been levied —
        // pure loss, reachable today via the manual attendance form regardless
        // of whether a Draft payroll row exists. Derives the SAME condition
        // `calcPayroll` enforces (`isPayrollChargeableSalaryType`) rather than a
        // second hardcoded list, so this guard tracks calc.ts automatically if
        // its supported salary types ever change. `employee == null` falls
        // through rather than refusing — an unknown id is not this guard's
        // concern, and every other guard below still applies to it unchanged.
        const employee = await tx.employee.findUnique({
          where: { id: input.employeeId },
          select: { salaryType: true, status: true },
        });
        if (employee && !isPayrollChargeableSalaryType(employee.salaryType as SalaryType)) {
          return { ok: false, error: 'unsupported-salary-type' };
        }

        // Defect 3: refuse for an Archived employee. `gatherAndCalc` (run.ts)
        // filters `status: { not: 'Archived' }`, so `actualPenaltyDaysForEmployee`
        // below returns `null` for one, and a `null` is treated as "no
        // calculable draft — don't block" by the `exceeds-penalty` guard that
        // follows. Left unguarded, that ceiling silently falls away and an
        // archived employee's settlement would be bounded only by their
        // leave balance, not by any actual penalty at all. Neither admin UI
        // can reach this today (both filter archived employees out of their
        // pickers), but this module's contract is that every guard here is
        // enforced server-side regardless of what the UI currently allows —
        // see the file-level doc-comment. Checked here, alongside the other
        // employee-shape guard above, rather than as a separate query.
        if (employee && employee.status === 'Archived') {
          return { ok: false, error: 'employee-archived' };
        }

        const leaveType = await tx.leaveType.findUnique({
          where: { id: input.leaveTypeId },
          select: { penaltySettlementAllowed: true, archivedAt: true },
        });
        if (!leaveType || leaveType.archivedAt || !leaveType.penaltySettlementAllowed) {
          return { ok: false, error: 'leave-type-not-allowed' };
        }

        const year = periodYearOf(input.month);

        // Defect 1 (concurrency): serialize against `approveLeaveRequest`
        // (leave/admin.ts), which takes an advisory lock on this SAME
        // (employeeId, leaveTypeId, year) key — via the SAME `lockEntitlement`
        // helper (leave/balance.ts) — before it reads this employee's balance.
        // Without this, a concurrent settle and approval each read the balance
        // before the other commits (transactions run at ReadCommitted) and
        // together overdraw it: e.g. approve reads `used=0` and freezes no
        // deduction, settle reads the same pre-approval balance and writes a
        // settlement, both commit, and the balance goes negative — which for a
        // `Block`-policy type (ลาพักร้อน) then wrongly refuses every later
        // request for the rest of the year, and for a `DeductPay` type
        // (ลากิจ) makes the live over-quota replay charge money on top of the
        // leave day already spent, defeating the reason this feature exists.
        // Locked on `input.leaveTypeId` (the type this call is about to spend
        // from), NOT `existing.leaveTypeId` when an edit switches types — a
        // switch only ever CREDITS the old type back (see `creditBack` below),
        // which cannot overdraw it, so only the type being spent needs the lock.
        //
        // Must run BEFORE `remainingByTypeForEmployee` below, same ordering
        // rule as `lockPayrollMonth` two lines up: the lock only closes the
        // race if it's held before the balance read, not merely held somewhere
        // in the transaction.
        //
        // Deadlock analysis: `approveLeaveRequest` takes ONLY this leave lock,
        // never `lockPayrollMonth`. `publishPayroll` takes ONLY the month lock,
        // never this one. This function is the only place that ever holds
        // both, and it always acquires them in the same order — month lock
        // (`lockPayrollMonth` above) THEN this leave lock — so no transaction
        // can be holding this leave lock while waiting on the month lock, which
        // is what a cycle would require. No deadlock is possible.
        //
        // `clearPenaltySettlement` does NOT take this lock: it only ever
        // releases entitlement (soft-deletes the row, crediting minutes back),
        // and has no balance check to race — a release can't overdraw a
        // balance no matter when it lands relative to a concurrent approval or
        // settle.
        await lockEntitlement(tx, input.employeeId, input.leaveTypeId, year);

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
          select: {
            id: true,
            days: true,
            minutes: true,
            leaveTypeId: true,
            deletedAt: true,
            note: true,
          },
        });
        const creditBack =
          existing && !existing.deletedAt && existing.leaveTypeId === input.leaveTypeId
            ? existing.minutes
            : 0;

        if (minutes > available + creditBack) return { ok: false, error: 'insufficient-balance' };

        // Defect 2: refuse settling more days than this (employee, month, kind)
        // penalty actually justifies — without this, `moneyDaysFor` clamps the
        // money side to zero but the leave side has no floor, so e.g. 5 days
        // settled against a single Absent silently destroys 4 days of
        // entitlement for nothing. Checked AFTER insufficient-balance (not
        // before) so a request that's both over-the-penalty AND over-balance
        // still reads as the more familiar `insufficient-balance` — same
        // observable behaviour as before this guard existed for that case.
        // `actualPenaltyDaysForEmployee` reuses the exact breakdown
        // `calcPayroll`/the reconcile page's chip already compute — see its
        // doc-comment in run.ts for why this is a bounded, per-employee cost,
        // not a full-month recompute. `null` (no calculable draft) falls
        // through rather than refusing, same reasoning as the employee lookup
        // above.
        const actualDays = await actualPenaltyDaysForEmployee(tx, input.month, input.employeeId);
        if (actualDays && input.days > actualDays[input.kind]) {
          return { ok: false, error: 'exceeds-penalty' };
        }

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
                note: existingLive.note,
              }
            : undefined,
          after: {
            employeeId: input.employeeId,
            month: input.month,
            kind: input.kind,
            leaveTypeId: input.leaveTypeId,
            days: input.days,
            minutes,
            note: input.note ?? null,
          },
          metadata: { source: 'server-action', via: input.via, ip, userAgent },
        });

        return { ok: true };
      }),
    isBusyResult,
  );
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
  await requireGlobalPermission('payroll.run');

  // A malformed id/month can never match a real row, so this is just an
  // early "no settlement" rather than a distinct error — same `null`
  // result the not-found path below returns, and it keeps a bad
  // `employeeId` from reaching a `@db.Uuid` column and throwing
  // `invalid input syntax for type uuid` instead of resolving cleanly.
  if (!MONTH_RE.test(input.month) || !UUID_RE.test(input.employeeId)) return null;

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
  await requireGlobalPermission('payroll.run');

  // Same reasoning as getPenaltySettlement above: a malformed month would
  // otherwise reach `periodYearOf` as `Number('bogus'.slice(0, 4))` → NaN,
  // and a malformed employeeId would reach a `@db.Uuid` column and throw.
  // Neither balance is meaningful for a request that can't identify a real
  // employee/period, so report it the same way as "nothing to show" — an
  // empty record, matching this function's existing "no data for this type"
  // convention (see the `null` → `0` comment below).
  if (!MONTH_RE.test(input.month) || !UUID_RE.test(input.employeeId)) return {};

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
  /** Same discriminator as `setPenaltySettlement.via` — which surface
   *  triggered the clear. */
  via: 'manual-attendance' | 'reconcile';
}): Promise<Result> {
  // B-payroll-guard Layer 1 — see the comment on setPenaltySettlement.
  const { user } = await requireGlobalPermission('payroll.run');

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  if (!MONTH_RE.test(input.month)) {
    return { ok: false, error: 'invalid-month' };
  }
  if (!UUID_RE.test(input.employeeId)) {
    return { ok: false, error: 'invalid-employee' };
  }

  // Same lock + transaction reasoning as setPenaltySettlement: the guard and
  // the write it protects must not be split by a concurrent publish or a
  // concurrent settlement on another kind for this employee/month. Same
  // non-blocking lock + short retry too — see the comments on
  // setPenaltySettlement above.
  return withMonthLockRetry(
    () =>
      prisma.$transaction(async (tx) => {
        if (!(await lockPayrollMonth(tx, input.month))) {
          return { ok: false, error: 'busy' };
        }

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
          select: { id: true, days: true, minutes: true, leaveTypeId: true, note: true },
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
              note: existing.note,
            },
            after: { cleared: true },
            metadata: { source: 'server-action', via: input.via, ip, userAgent },
          });
        }

        return { ok: true };
      }),
    isBusyResult,
  );
}
