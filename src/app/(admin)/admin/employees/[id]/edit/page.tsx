import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { loadEmployeeFormOptions } from '../../_load-options';
import { archiveEmployee, updateEmployee } from '../../actions';
import { EmployeeForm } from '../../employee-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; ok?: string }>;

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error, ok } = await searchParams;

  const [emp, options] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        branchId: true,
        assignedBranchIds: true,
        departmentId: true,
        accountingGroupId: true,
        workScheduleId: true,
        salaryType: true,
        baseSalary: true,
        status: true,
        canCheckIn: true,
        hiredAt: true,
        archivedAt: true,
        user: { select: { lineUserId: true, authUserId: true } },
      },
    }),
    loadEmployeeFormOptions(),
  ]);
  if (!emp) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">
          แก้ไข: {emp.firstName} {emp.lastName}
        </h1>
        <LineStatus lineUserId={emp.user.lineUserId} authUserId={emp.user.authUserId} />
      </div>

      {ok === '1' && (
        <div role="status" className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          บันทึกเรียบร้อย
        </div>
      )}

      <EmployeeForm
        mode="edit"
        action={updateEmployee.bind(null, id)}
        options={options}
        error={error ? decodeURIComponent(error) : null}
        initial={{
          firstName: emp.firstName,
          lastName: emp.lastName,
          nickname: emp.nickname,
          branchId: emp.branchId,
          assignedBranchIds: emp.assignedBranchIds,
          departmentId: emp.departmentId,
          accountingGroupId: emp.accountingGroupId,
          workScheduleId: emp.workScheduleId,
          salaryType: emp.salaryType,
          baseSalary: String(emp.baseSalary),
          status: emp.status,
          canCheckIn: emp.canCheckIn,
          hiredAt: emp.hiredAt.toISOString().slice(0, 10),
        }}
        extraActions={
          emp.archivedAt ? null : (
            <form action={archiveEmployee.bind(null, id)}>
              <Button type="submit" variant="destructive">
                พ้นสภาพ
              </Button>
            </form>
          )
        }
      />
    </div>
  );
}

function LineStatus({
  lineUserId,
  authUserId,
}: {
  lineUserId: string | null;
  authUserId: string | null;
}) {
  if (lineUserId) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
        <span aria-hidden="true">✅</span>
        LINE เชื่อมแล้ว
      </span>
    );
  }
  if (authUserId) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700">
        <span aria-hidden="true">⏳</span>
        รอเชื่อม LINE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
      <span aria-hidden="true">📩</span>
      ยังไม่ได้ส่งลิงก์
    </span>
  );
}
