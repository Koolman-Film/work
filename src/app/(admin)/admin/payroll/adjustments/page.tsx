import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';
import { formatTHB2 } from '@/lib/format';
import { frequencyOf } from './adjustment-schema';

/**
 * /admin/payroll/adjustments — list of เงินเพิ่ม/เงินลด entries.
 *
 * Soft-deleted rows are filtered by the Prisma extension. Sorted by
 * newest first — admins typically come here right after agreeing a new
 * allowance/deduction with the employee.
 */

type SearchParams = Promise<{ error?: string }>;

const FREQ_LABEL = { once: 'รายครั้ง', monthly: 'รายเดือน', range: 'ตามช่วงเวลา' } as const;

function windowLabel(startMonth: string, endMonth: string | null): string {
  const freq = frequencyOf(startMonth, endMonth);
  if (freq === 'once') return startMonth;
  if (freq === 'monthly') return `${startMonth} เป็นต้นไป`;
  return `${startMonth} – ${endMonth}`;
}

export default async function AdjustmentListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  const rows = await prisma.payrollAdjustment.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'employee',
      header: 'พนักงาน',
      cell: (r) => (
        <span className="font-medium text-ink-1">
          {r.employee.firstName} {r.employee.lastName}
          {r.employee.nickname ? ` (${r.employee.nickname})` : ''}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'ประเภท',
      cell: (r) =>
        r.kind === 'Income' ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            เงินเพิ่ม
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            เงินลด
          </span>
        ),
    },
    {
      key: 'reason',
      header: 'รายการ',
      cell: (r) => <span className="text-ink-2">{r.reason}</span>,
    },
    {
      key: 'amount',
      header: 'จำนวนเงิน',
      cell: (r) => <span className="font-mono text-ink-1">{formatTHB2(r.amount.toNumber())}</span>,
    },
    {
      key: 'frequency',
      header: 'ความถี่',
      cell: (r) => (
        <span className="text-ink-3">{FREQ_LABEL[frequencyOf(r.startMonth, r.endMonth)]}</span>
      ),
    },
    {
      key: 'window',
      header: 'ช่วงเดือน',
      cell: (r) => (
        <span className="font-mono text-xs text-ink-3">
          {windowLabel(r.startMonth, r.endMonth)}
        </span>
      ),
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เงินเดือน"
        title="เงินเพิ่ม / เงินลด"
        subtitle="รายการรายได้และรายการหักเพิ่มเติม — ถูกรวมเข้าสลิปอัตโนมัติตามช่วงเดือนที่กำหนด"
        actions={
          <Link href="/admin/payroll/adjustments/new">
            <Button>+ เพิ่มรายการ</Button>
          </Link>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep"
        >
          {decodeURIComponent(error)}
        </div>
      )}

      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        actions={(r) => (
          <Link
            href={`/admin/payroll/adjustments/${r.id}`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีรายการเงินเพิ่ม/เงินลด"
              action={
                <Link href="/admin/payroll/adjustments/new">
                  <Button variant="secondary">+ เพิ่มรายการแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
