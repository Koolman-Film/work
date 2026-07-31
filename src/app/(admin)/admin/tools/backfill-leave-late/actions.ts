'use server';

import { revalidatePath } from 'next/cache';
import { type BackfillReport, backfillLeaveLateRows } from '@/lib/attendance/backfill-leave-late';
import { requireRole } from '@/lib/auth/require-role';

/**
 * Parse the optional `since` bound. Same convention as the CLI's `--since=`
 * (scripts/backfill-leave-late-rows.ts): a UTC midnight from YYYY-MM-DD, which
 * is how attendance dates are stored. Throws rather than falling back to null —
 * a typo must not silently widen the scan to all history.
 */
function parseSince(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00.000Z`) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error('รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
  return d;
}

/**
 * Undo the pre-2026-07-23 bug where a Late row was measured from the
 * scheduled start even on a day the employee had an approved (morning) leave.
 * Superadmin-only — same gate as /owner, not a permission grant, because this
 * runs a one-shot recompute across every employee/date rather than a
 * routine payroll action any Admin might need. apply=false is a read-only
 * dry run; the exact same `backfillLeaveLateRows` core (and its integration
 * test) backs both the CLI script and this page, so they can never disagree.
 *
 * `sinceYmd` bounds the scan the same way the CLI's `--since=` does. Without it
 * this walks every OnLeave row ever recorded, and the per-day queries make that
 * grow with history — a scan long enough to hit the function timeout partway
 * through. Partial application is safe to re-run, but a bounded scan that
 * finishes is better than an unbounded one that may not.
 */
export async function runBackfillLeaveLateRows(
  apply: boolean,
  sinceYmd?: string | null,
): Promise<BackfillReport> {
  const { user } = await requireRole(['Superadmin']);
  const since = parseSince(sinceYmd);
  const report = await backfillLeaveLateRows({ apply, actorId: user.id, since });
  if (apply && (report.counts.delete > 0 || report.counts.lower > 0)) {
    // No aggregate audit row here. `backfillLeaveLateRows` already writes one
    // per mutated Attendance row, in the same transaction as the mutation and
    // keyed by that row's real UUID, carrying the same actorId — so a summary
    // row adds only counts that are derivable from those rows. It also could
    // not be written: AuditLog.entityId is @db.Uuid and this passed 'bulk'.
    revalidatePath('/admin/attendance');
  }
  return report;
}
