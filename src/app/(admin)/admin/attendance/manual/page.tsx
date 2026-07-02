/**
 * /admin/attendance/manual — admin creates Attendance rows directly
 * for cases where employees couldn't tap LIFF (sick, forgot phone, etc.).
 *
 * Per docs/v1/screens/admin.md S-N10 + F-N5.
 *
 * Allowed types are Absent / Late / EarlyLeave only. CheckIn/CheckOut
 * are deliberately excluded (would bypass GPS verification); OnLeave is
 * auto-created by leave approval and shouldn't be hand-entered.
 */

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { employeeBranchScope, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AttendanceTabs } from '../attendance-tabs';
import { ManualAttendanceForm } from './manual-form';

export default async function ManualAttendancePage() {
  const { user } = await requirePermission('attendance.manual-create');
  const permitted = await getPermittedBranches(user, 'attendance.manual-create');

  const employees = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      ...employeeBranchScope(permitted),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
    },
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="คีย์มือ — บันทึกการขาด/ลา/สาย"
        subtitle="ใช้เมื่อพนักงานไม่สามารถเช็คอินด้วย LINE ได้ — เช่น ป่วย, ลืมโทรศัพท์"
      />
      <AttendanceTabs current="manual" />

      <div>
        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
          </CardHeader>
          <CardBody>
            <ManualAttendanceForm
              employees={employees.map((e) => ({
                id: e.id,
                label:
                  `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''} — ${e.branch.name}`.trim(),
              }))}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
