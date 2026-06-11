import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { requirePermission } from '@/lib/auth/check-permission';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function RoleListPage({ searchParams }: { searchParams: SearchParams }) {
  // role.read is in every Admin's default perm list — Superadmin
  // gets it via the isSuperadmin shortcut. Page is view-only; the
  // edit/new pages and the actions gate on role.manage (Superadmin only).
  await requirePermission('role.read');
  const { error } = await searchParams;

  const totalPermCount = Object.keys(PERMISSIONS).length;

  const roles = await prisma.roleDefinition.findMany({
    where: { archivedAt: null },
    orderBy: [
      { isSystem: 'desc' }, // system roles first
      { name: 'asc' },
    ],
    include: {
      _count: { select: { assignments: true } },
    },
  });

  const columns: Column<(typeof roles)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (r) => (
        <span className="font-medium text-ink-1">
          {r.name}
          <code className="ml-2 rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-normal text-ink-3">
            {r.key}
          </code>
        </span>
      ),
    },
    {
      key: 'description',
      header: 'คำอธิบาย',
      cell: (r) => (
        <span className="line-clamp-2 max-w-xs text-xs text-ink-3">{r.description ?? '—'}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'permissions',
      header: 'สิทธิ์',
      cell: (r) =>
        r.isSuperadmin ? (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
            ทั้งหมด ({totalPermCount})
          </span>
        ) : (
          <span className="tabular-nums text-ink-2">
            {r.permissions.length} / {totalPermCount}
          </span>
        ),
    },
    {
      key: 'assignments',
      header: 'ผู้ใช้',
      cell: (r) => <span className="tabular-nums text-ink-2">{r._count.assignments}</span>,
    },
    {
      key: 'type',
      header: 'ประเภท',
      cell: (r) =>
        r.isSystem ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            ระบบ
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            กำหนดเอง
          </span>
        ),
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="บทบาทและสิทธิ์"
        subtitle="จัดการบทบาทระบบ + สร้างบทบาทกำหนดเองสำหรับผู้ดูแลและพนักงาน"
        actions={
          <Link href="/admin/settings/roles/new">
            <Button>+ เพิ่มบทบาท</Button>
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
        rows={roles}
        rowKey={(r) => r.id}
        actions={(r) => (
          <Link
            href={`/admin/settings/roles/${r.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีบทบาท"
              action={
                <Link href="/admin/settings/roles/new">
                  <Button variant="secondary">+ เพิ่มบทบาทแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />

      <p className="mt-3 text-xs text-ink-3">
        บทบาทระบบ (Superadmin / Admin / Staff) มาพร้อมระบบ — แก้ชื่อ + รายการสิทธิ์ได้ แต่ลบไม่ได้
        ส่วนบทบาทกำหนดเองลบได้เมื่อไม่มีผู้ใช้ที่ได้รับมอบหมาย
      </p>
    </div>
  );
}
