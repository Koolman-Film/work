'use server';

import { auditLogMany } from '@/lib/audit/log';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { type RecomputeResult, recomputeLeaveCharges } from '@/lib/leave/recompute';

/**
 * Recompute leave charges + over-quota deductions (admin maintenance tool).
 * Gated on payroll.publish — same sensitivity as committing payroll, because it
 * changes frozen deduction amounts. apply=false is a read-only dry run.
 */
export async function runLeaveRecompute(apply: boolean): Promise<RecomputeResult> {
  const { user } = await requireGlobalPermission('payroll.publish');
  const result = await recomputeLeaveCharges({ apply });
  if (apply && result.applied > 0) {
    // One row per rewritten LeaveRequest, not one 'bulk' summary row. This tool
    // changes frozen deduction amounts, so each affected request needs the
    // change in its OWN history — and `'bulk'` is not a UUID, so AuditLog
    // rejected it and this tool's only trail was silently dropped every run.
    //
    // Filtered to !swept: `changes` also lists paid rows, which recompute
    // deliberately never writes (`applied` counts only the unswept ones), and
    // auditing an untouched row as recomputed would be a false record.
    auditLogMany(
      result.changes
        .filter((c) => !c.swept)
        .map((c) => ({
          actorId: user.id,
          action: 'leave.recompute' as const,
          entityType: 'LeaveRequest' as const,
          entityId: c.leaveRequestId,
          before: {
            chargedMinutes: c.oldChargedMinutes,
            overQuotaMinutes: c.oldOverMinutes,
            deductAmount: c.oldDeduct,
          },
          after: {
            chargedMinutes: c.newChargedMinutes,
            overQuotaMinutes: c.newOverMinutes,
            deductAmount: c.newDeduct,
          },
          metadata: { source: 'admin-tool', scanned: result.scanned, applied: result.applied },
        })),
    );
  }
  return result;
}
