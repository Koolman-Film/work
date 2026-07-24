'use server';

import { revalidatePath } from 'next/cache';
import { type BackfillReport, backfillLeaveLateRows } from '@/lib/attendance/backfill-leave-late';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';

/**
 * Undo the pre-2026-07-23 bug where a Late row was measured from the
 * scheduled start even on a day the employee had an approved (morning) leave.
 * Superadmin-only — same gate as /owner, not a permission grant, because this
 * runs a one-shot recompute across every employee/date rather than a
 * routine payroll action any Admin might need. apply=false is a read-only
 * dry run; the exact same `backfillLeaveLateRows` core (and its integration
 * test) backs both the CLI script and this page, so they can never disagree.
 */
export async function runBackfillLeaveLateRows(apply: boolean): Promise<BackfillReport> {
  const { user } = await requireRole(['Superadmin']);
  const report = await backfillLeaveLateRows({ apply, actorId: user.id });
  if (apply && (report.counts.delete > 0 || report.counts.lower > 0)) {
    auditLog({
      actorId: user.id,
      action: 'attendance.edit',
      entityType: 'Attendance',
      entityId: 'bulk',
      after: { source: 'backfill-leave-late-rows', counts: report.counts },
      metadata: { source: 'admin-tool' },
    });
    revalidatePath('/admin/attendance');
  }
  return report;
}
