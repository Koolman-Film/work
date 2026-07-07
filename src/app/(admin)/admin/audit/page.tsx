import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { buildAuditWhere, fetchAuditPage, resolveActors } from '@/lib/audit/query';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { AuditFilters } from './audit-filters';
import { AuditRow, type AuditRowData } from './audit-row';

/**
 * Audit log feed (Superadmin/global-permission only): URL-driven filters +
 * keyset pagination over AuditLog, newest first. Mirrors the employee list's
 * where-clause-from-searchParams pattern, but paginates by cursor (not
 * offset) since the log is append-only and can grow large.
 */

type SearchParams = Promise<{
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}>;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireGlobalPermission('audit.read');
  const sp = await searchParams;

  const where = buildAuditWhere(sp);
  const { rows, nextCursor } = await fetchAuditPage(where, sp.cursor);

  const actorMap = await resolveActors(rows.map((r) => r.actorId));

  // Actor filter options: users who hold at least one role assignment (admins/owners).
  const admins = await prisma.user.findMany({
    where: { roleAssignments: { some: {} } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const actorOptions = admins.map((u) => ({
    id: u.id,
    label: u.employee
      ? `${u.employee.firstName} ${u.employee.lastName}`
      : (u.email ?? u.id.slice(0, 8)),
  }));

  const data: AuditRowData[] = rows.map((r) => ({
    id: r.id,
    actorLabel: r.actorId ? (actorMap.get(r.actorId) ?? r.actorId.slice(0, 8)) : 'ระบบ',
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    before: r.beforeValue,
    after: r.afterValue,
    metadata: r.metadata,
  }));

  // Preserve active filters when following the next-page cursor link.
  const nextParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== 'cursor' && typeof v === 'string' && v) nextParams.set(k, v);
  }
  if (nextCursor) nextParams.set('cursor', nextCursor);
  const nextHref = `/admin/audit?${nextParams.toString()}`;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ประวัติการเปลี่ยนแปลง" title="ประวัติการเปลี่ยนแปลง" />

      <AuditFilters
        initial={{
          actor: sp.actor,
          action: sp.action,
          entityType: sp.entityType,
          dateFrom: sp.dateFrom,
          dateTo: sp.dateTo,
        }}
        actors={actorOptions}
      />

      {data.length === 0 ? (
        <div className="surface p-8 text-center text-ink-4">ไม่พบรายการที่ตรงกับตัวกรอง</div>
      ) : (
        <ul className="space-y-2">
          {data.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Link href={nextHref}>
            <Button variant="secondary">ถัดไป →</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
