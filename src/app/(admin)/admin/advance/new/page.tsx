/**
 * /admin/advance/new — admin records a cash-advance on behalf of an employee.
 *
 * The advance counterpart to /admin/leave/new: for a worker who can't use LIFF
 * (broken phone, etc.), an admin keys in the request here. It creates a Pending
 * CashAdvance; the admin then approves it from the inbox (with the receipt
 * upload + money-confirm). Same guards as the worker submit (฿100k cap, one
 * pending per employee) live in adminCreateCashAdvance.
 */

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { employeeBranchScope, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AdminAdvanceForm } from './admin-advance-form';

export default async function AdminCreateAdvancePage() {
  const { user } = await requirePermission('advance.approve');
  const permitted = await getPermittedBranches(user, 'advance.approve');

  const employees = await prisma.employee.findMany({
    where: { archivedAt: null, status: { not: 'Archived' }, ...employeeBranchScope(permitted) },
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
        breadcrumb="เบิกเงินล่วงหน้า / บันทึกแทนพนักงาน"
        title="บันทึกการเบิกเงิน (แทนพนักงาน)"
        subtitle="บันทึกคำขอเบิกเงินแทนพนักงานที่ใช้แอปไม่ได้ (เช่น โทรศัพท์เสีย) — รายการจะเข้าคิวรออนุมัติ จากนั้นกดอนุมัติพร้อมแนบสลิป"
      />

      <div>
        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
          </CardHeader>
          <CardBody>
            <AdminAdvanceForm
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
