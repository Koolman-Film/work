/**
 * Admin dashboard — landing page after Admin login.
 *
 * Currently a placeholder showing session info + a quick-link grid to the
 * CRUD pages. Real KPI cards (pending leave/advance, today's check-ins)
 * land in W4 when those flows exist.
 */

import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

export default async function AdminHomePage() {
  const { user } = await requireRole(['Admin']);

  // Quick counts so the dashboard isn't empty
  const [branchCount, deptCount, accGroupCount, employeeCount] = await Promise.all([
    prisma.branch.count({ where: { archivedAt: null } }),
    prisma.department.count({ where: { archivedAt: null } }),
    prisma.accountingGroup.count({ where: { archivedAt: null } }),
    prisma.employee.count({ where: { archivedAt: null } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">แดชบอร์ด</h1>
        <p className="text-sm text-gray-500">สวัสดี, {user.email}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="พนักงาน" value={employeeCount} href="/admin/employees" />
        <StatCard label="สาขา" value={branchCount} href="/admin/branches" />
        <StatCard label="แผนก" value={deptCount} href="/admin/departments" />
        <StatCard label="กลุ่มบัญชี" value={accGroupCount} href="/admin/accounting-groups" />
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>การเข้างานวันนี้</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-gray-500">(ยังว่าง — รอ Phase 1 W3 LIFF check-in)</p>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
    </Link>
  );
}
