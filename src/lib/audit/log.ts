/**
 * Append-only audit log writer.
 *
 * Every mutation that touches business data should log through here. The
 * audit table is read by Superadmin and Admin in Phase 3; for now we just write
 * faithfully and worry about the UI later.
 *
 * Design choices:
 *   - **Fire-and-forget**: caller doesn't await the write. Failure to audit
 *     should not break the mutation that succeeded — audit is best-effort.
 *     We log to console.error so Sentry (when wired) catches the loss.
 *   - **No FK constraint on actorId**: `AuditLog.actorId` is just a UUID
 *     column, not a foreign key. This lets us soft-delete Users without
 *     CASCADE-ing or NULL-ing their audit history.
 *   - **Before/after as Json**: arbitrary shape. We don't enforce a schema
 *     so the writer can capture whatever's relevant per entity type.
 *   - **Metadata for request context**: IP, user-agent, source action.
 *     The caller supplies these because they have access to the request
 *     headers; this helper doesn't reach into next/headers.
 */

import { Prisma } from '@prisma/client';
import { prisma, type prismaRaw } from '@/lib/db/prisma';

/**
 * Transaction client accepted by {@link auditLogTx}.
 *
 * `prisma` is `$extends`-ed (soft-delete filter), so the `tx` handed to a
 * `prisma.$transaction` callback is the EXTENDED transaction-client type — not
 * the plain `Prisma.TransactionClient`. We derive the type from both clients so
 * callers can pass either the extended `tx` (normal mutations) or the raw `tx`
 * (void/restore actions via `prismaRaw.$transaction`).
 */
type ExtendedTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type RawTx = Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0];
type AuditTransactionClient = ExtendedTx | RawTx;

export type AuditAction =
  // Identity
  | 'user.create'
  | 'user.archive'
  | 'user.delete'
  | 'user.role-change'
  | 'user.locale-change'
  | 'user.password-reset'
  | 'user.password-change'
  // Admin self-serve LINE pairing (admin LINE experience)
  | 'user.admin-line-invite'
  | 'user.admin-line-link'
  | 'user.admin-line-unlink'
  | 'user.account-merge'
  // Granular role/permission management (Phase 1+ — see docs/v2/permissions.md)
  | 'role.create'
  | 'role.update'
  | 'role.archive'
  | 'roleAssignment.create'
  | 'roleAssignment.delete'
  // Employee
  | 'employee.create'
  | 'employee.update'
  | 'employee.archive'
  | 'employee.delete'
  | 'employee.rehire'
  | 'employee.line-link'
  | 'employee.line-unlink'
  | 'employee.profile.self-update'
  // Org
  | 'branch.create'
  | 'branch.update'
  | 'branch.archive'
  | 'department.create'
  | 'department.update'
  | 'department.archive'
  | 'accountingGroup.create'
  | 'accountingGroup.update'
  | 'accountingGroup.archive'
  | 'workSchedule.create'
  | 'workSchedule.update'
  | 'workSchedule.archive'
  | 'leaveType.create'
  | 'leaveType.update'
  | 'leaveType.archive'
  | 'leaveConfig.update'
  | 'payrollConfig.update'
  | 'leaveEntitlement.update'
  | 'overtime.approve'
  | 'overtime.dismiss'
  | 'overtime.void'
  | 'holiday.create'
  | 'holiday.update'
  | 'holiday.archive'
  // Attendance
  | 'attendance.checkin'
  | 'attendance.checkout'
  | 'attendance.late-auto'
  | 'attendance.manual-create'
  | 'attendance.edit'
  | 'attendance.dispute-approve'
  | 'attendance.dispute-reject'
  | 'attendance.force-checkout'
  | 'attendance.void'
  | 'attendance.restore'
  // Leave & advance
  | 'leave.submit'
  | 'leave.admin-create'
  | 'leave.approve'
  | 'leave.reject'
  | 'leave.cancel'
  | 'leave.void'
  | 'leave.restore'
  | 'leave.recompute'
  | 'leave.correct-type'
  | 'leave.waive-deduction'
  | 'attendance.correct-time'
  | 'advance.submit'
  | 'advance.admin-create'
  | 'advance.approve'
  | 'advance.reject'
  | 'advance.mark-paid'
  | 'advance.cancel'
  | 'advance.void'
  | 'advance.restore'
  // Payroll
  | 'payroll.run'
  | 'payroll.override'
  | 'payroll.publish'
  | 'payroll.unlock'
  | 'payroll.revise'
  | 'payslip.download'
  | 'payslip.preview'
  | 'recurringDeduction.create'
  | 'recurringDeduction.edit'
  | 'recurringDeduction.end'
  | 'payrollAdjustment.create'
  | 'payrollAdjustment.edit'
  | 'payrollAdjustment.delete'
  | 'penaltySettlement.create'
  | 'penaltySettlement.update'
  | 'penaltySettlement.clear';

export type AuditEntityType =
  | 'User'
  // 'Employee' here is the Prisma Employee MODEL (HR record), NOT the
  // legacy Role enum value (which was renamed to 'Staff' in 0009).
  | 'Employee'
  | 'Branch'
  | 'RoleDefinition'
  | 'UserRoleAssignment'
  | 'Department'
  | 'AccountingGroup'
  | 'WorkSchedule'
  | 'LeaveType'
  | 'LeaveConfig'
  | 'PayrollConfig'
  | 'LeaveEntitlement'
  | 'OvertimeEntry'
  | 'Holiday'
  | 'Attendance'
  | 'LeaveRequest'
  | 'CashAdvance'
  | 'Payroll'
  | 'PayrollAdjustment'
  | 'RecurringDeduction'
  | 'AttendancePenaltySettlement';

export interface AuditLogParams {
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: Prisma.JsonValue;
  after?: Prisma.JsonValue;
  metadata?: {
    ip?: string;
    userAgent?: string;
    source?: string; // e.g. 'admin-ui', 'liff', 'cron', 'inngest'
    [k: string]: Prisma.JsonValue | undefined;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `AuditLog.entityId` is `@db.Uuid` (schema.prisma), so anything that is not a
 * UUID — a composite key like `<employeeId>:<month>`, a sentinel like 'bulk' or
 * 'new' — makes Postgres reject the INSERT. Because `auditLog` is
 * fire-and-forget and swallows its own errors, such a call site fails silently
 * and 100% of the time: `payslip.download` wrote nothing for six weeks (306
 * failures) before anyone noticed, leaving no record of who read whose payslip.
 *
 * Fail LOUDLY outside production so the first test or dev run catches it, and
 * stay silent in production, where an audit write must never break a request
 * (the catch below still logs it). Every ID a caller passes must be the real
 * UUID of a real row; a discriminator like a month belongs in `metadata`.
 */
function assertUuidEntityId(params: AuditLogParams): void {
  if (process.env.NODE_ENV === 'production') return;
  if (UUID_RE.test(params.entityId)) return;
  throw new Error(
    `[audit] entityId must be a UUID — AuditLog.entityId is @db.Uuid, so ` +
      `"${params.entityId}" (action "${params.action}") would be rejected by ` +
      `Postgres and silently dropped. Pass the row's id; put month//scope in metadata.`,
  );
}

/**
 * Fire-and-forget audit write. Returns immediately; the underlying Promise
 * is logged on failure but never awaited from the caller's perspective.
 *
 * For callers that need transactional consistency (e.g. multi-row mutation
 * with audit as part of the same DB transaction), use `auditLogTx` instead.
 */
export function auditLog(params: AuditLogParams): void {
  assertUuidEntityId(params);
  void prisma.auditLog
    .create({
      data: {
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        beforeValue: params.before ?? Prisma.JsonNull,
        afterValue: params.after ?? Prisma.JsonNull,
        metadata: params.metadata ?? Prisma.JsonNull,
      },
    })
    .catch((err: unknown) => {
      // Audit must not break the request. Log loudly so Sentry catches it
      // (once wired). Never re-throw.
      console.error('[audit] write failed', {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Transactional variant — pass the active Prisma transaction client to
 * include the audit write in the same atomic unit as the business mutation.
 *
 * Use when "if the mutation rolled back, the audit row must too" matters.
 * E.g.: leave-approve creates Attendance rows; if any insertion fails,
 * we don't want a "leave.approve" audit row claiming it happened.
 */
export async function auditLogTx(
  tx: AuditTransactionClient,
  params: AuditLogParams,
): Promise<void> {
  assertUuidEntityId(params);
  await tx.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeValue: params.before ?? Prisma.JsonNull,
      afterValue: params.after ?? Prisma.JsonNull,
      metadata: params.metadata ?? Prisma.JsonNull,
    },
  });
}

/**
 * Fire-and-forget batch write — one INSERT for many rows.
 *
 * For actions that touch many entities at once (a payslip ZIP is N separate
 * accesses to N employees' salary documents; a recompute rewrites N leave
 * requests). Writing one row per entity is what makes the trail answer "who
 * touched WHOSE record", and keeps every `entityId` a real UUID — the
 * alternative, one summary row, has no single entity to point at.
 */
export function auditLogMany(rows: ReadonlyArray<AuditLogParams>): void {
  if (rows.length === 0) return;
  for (const r of rows) assertUuidEntityId(r);
  void prisma.auditLog
    .createMany({
      data: rows.map((params) => ({
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        beforeValue: params.before ?? Prisma.JsonNull,
        afterValue: params.after ?? Prisma.JsonNull,
        metadata: params.metadata ?? Prisma.JsonNull,
      })),
    })
    .catch((err: unknown) => {
      console.error('[audit] batch write failed', {
        action: rows[0]?.action,
        count: rows.length,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

// Re-export Prisma so callers don't need a second import for JsonNull
export { Prisma };
