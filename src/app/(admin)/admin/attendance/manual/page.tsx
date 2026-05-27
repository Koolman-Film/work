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
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { ManualAttendanceForm } from './manual-form';

export default async function ManualAttendancePage() {
  await requireRole(['Admin']);

  // Load active employees for the dropdown. We exclude archived + non-
  // active status. ~50 employees max at Phase-1 scale, so no pagination.
  const employees = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
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
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">บันทึกการขาด/ลา/สาย (ด้วยตนเอง)</h1>
        <p className="mt-1 text-sm text-gray-500">
          ใช้เมื่อพนักงานไม่สามารถเช็คอินด้วย LINE ได้ — เช่น ป่วย, ลืมโทรศัพท์
        </p>
      </div>

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
  );
}
