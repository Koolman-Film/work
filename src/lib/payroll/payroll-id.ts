import { prisma } from '@/lib/db/prisma';

/**
 * The `Payroll.id` for one (employee, month), or null if no row exists yet.
 *
 * Exists for audit writes. `AuditLog.entityId` is `@db.Uuid`, so an audit row
 * with `entityType: 'Payroll'` must carry a real Payroll UUID — the composite
 * `<employeeId>:<month>` the payslip routes used to pass is rejected by
 * Postgres and, because `auditLog` swallows its own errors, was dropped
 * silently on every download for six weeks.
 *
 * `(employeeId, month)` is unique (payroll/run.ts upserts on
 * `employeeId_month`), so this is a single indexed lookup. Payslip downloads
 * are rare enough that one extra query per download costs nothing next to
 * rendering a PDF.
 *
 * Returns null rather than throwing: a missing Payroll row must never fail the
 * download the caller is auditing — the caller skips the audit write instead.
 */
export async function payrollIdFor(employeeId: string, month: string): Promise<string | null> {
  const row = await prisma.payroll.findFirst({
    where: { employeeId, month },
    select: { id: true },
  });
  return row?.id ?? null;
}
