/**
 * /admin/leave/new — admin records a leave request on behalf of an employee.
 *
 * Exists to close the back-dating gap: workers can only self-file leave up to
 * a few days in the past (MAX_BACKDATE_DAYS in src/lib/leave/actions.ts). When
 * something older needs recording, an admin does it here with any past date.
 * The form creates a Pending request; the admin then approves it from the
 * inbox, which is what expands it into Attendance(OnLeave) rows.
 */

import { redirect } from 'next/navigation';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AdminLeaveForm } from './admin-leave-form';

export default async function AdminCreateLeavePage() {
  await requirePermission('leave.approve');

  const [employees, leaveTypes] = await Promise.all([
    prisma.employee.findMany({
      where: { archivedAt: null, status: { not: 'Archived' } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        branch: { select: { name: true } },
      },
    }),
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isPaid: true,
        allowFullDay: true,
        allowHalfDay: true,
        allowHourly: true,
      },
    }),
  ]);

  if (leaveTypes.length === 0) {
    redirect('/admin/leave');
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="คำขอลา / บันทึกย้อนหลัง"
        title="บันทึกการลา (ย้อนหลังได้)"
        subtitle="บันทึกการลาแทนพนักงานสำหรับวันที่ผ่านมาแล้ว — รายการจะเข้าคิวรออนุมัติ จากนั้นกดอนุมัติเพื่อสร้างรายการลงเวลา (OnLeave)"
      />

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
          </CardHeader>
          <CardBody>
            <AdminLeaveForm
              employees={employees.map((e) => ({
                id: e.id,
                label:
                  `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''} — ${e.branch.name}`.trim(),
              }))}
              leaveTypes={leaveTypes}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
