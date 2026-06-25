'use server';

import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { type RecomputeResult, recomputeLeaveCharges } from '@/lib/leave/recompute';

/**
 * Recompute leave charges + over-quota deductions (admin maintenance tool).
 * Gated on payroll.publish — same sensitivity as committing payroll, because it
 * changes frozen deduction amounts. apply=false is a read-only dry run.
 */
export async function runLeaveRecompute(apply: boolean): Promise<RecomputeResult> {
  const { user } = await requirePermission('payroll.publish');
  const result = await recomputeLeaveCharges({ apply });
  if (apply && result.applied > 0) {
    auditLog({
      actorId: user.id,
      action: 'leave.recompute',
      entityType: 'LeaveRequest',
      entityId: 'bulk',
      after: { applied: result.applied, scanned: result.scanned },
      metadata: { source: 'admin-tool' },
    });
  }
  return result;
}
