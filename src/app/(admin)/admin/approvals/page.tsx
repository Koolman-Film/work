import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { loadApprovalsInbox } from '@/lib/approvals/load-inbox';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { ApprovalsFilters } from './approvals-filters';
import { ApprovalsList } from './approvals-list';

/**
 * Unified /admin/approvals inbox — aggregates pending leave requests, cash
 * advances, and disputed attendance check-ins into a single, URL-filterable
 * list. Gated on ANY of the three read permissions (a user holding only
 * `advance.read`, say, still gets an inbox — just scoped to advances).
 */

type SearchParams = Promise<{ type?: string; branchId?: string; q?: string }>;

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, permissions } = await requireAdminArea();
  const canRead =
    permissions.has('leave.read') ||
    permissions.has('advance.read') ||
    permissions.has('attendance.read');
  if (!canRead) notFound();

  const sp = await searchParams;
  const assignments = await getUserAssignments(user.id);
  const { cards, counts, capped } = await loadApprovalsInbox(assignments, sp);

  const branches = await prisma.branch.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const canReview = {
    leave: permissions.has('leave.approve'),
    advance: permissions.has('advance.approve'),
    disputed: permissions.has('attendance.dispute-resolve'),
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="รออนุมัติ"
        title={`รออนุมัติ${counts.total > 0 ? ` (${counts.total})` : ''}`}
        subtitle="รวมคำขอลา เบิกล่วงหน้า และข้อโต้แย้งการลงเวลา ที่รอการอนุมัติ"
      />

      <ApprovalsFilters initial={sp} branches={branches} />

      {capped && (
        <p className="mb-3 text-xs text-ink-4">แสดงรายการล่าสุดบางส่วน — ใช้ตัวกรองเพื่อจำกัดผลลัพธ์</p>
      )}

      {cards.length === 0 ? (
        <div className="surface p-8 text-center text-ink-4">ไม่มีรายการรออนุมัติ</div>
      ) : (
        <ApprovalsList cards={cards} canReview={canReview} />
      )}
    </div>
  );
}
