import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { loadEmployeeFormOptions } from '../../_load-options';
import { archiveEmployee, deleteEmployee, updateEmployee } from '../../actions';
import { EmployeeForm } from '../../employee-form';
import { PairingCard } from '../../pairing-card';
import { DangerActions } from './danger-actions';

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
        inviteToken: true,
        inviteExpiresAt: true,
        user: { select: { lineUserId: true, authUserId: true } },
      },
    }),
    loadEmployeeFormOptions(),
  ]);
  if (!emp) notFound();

  // Build absolute base URL from request headers — works dev / preview / prod
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="พนักงาน"
        title={`แก้ไข: ${emp.firstName} ${emp.lastName}`}
        actions={<LineStatus lineUserId={emp.user.lineUserId} authUserId={emp.user.authUserId} />}
      />

      {ok === '1' && (
        <div
          role="status"
          className="rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep"
        >
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
          // Archive + Delete are ConfirmDialog triggers (type="button") in the
          // action bar — they call their bound server actions directly, so
          // there is no nested form.
          emp.archivedAt ? null : (
            <DangerActions
              archiveAction={archiveEmployee.bind(null, id)}
              deleteAction={deleteEmployee.bind(null, id)}
              employeeName={`${emp.firstName} ${emp.lastName}`.trim()}
            />
          )
        }
        belowForm={
          <PairingCard
            employeeId={id}
            employeeName={`${emp.firstName} ${emp.lastName}`.trim()}
            inviteToken={emp.inviteToken}
            inviteExpiresAt={emp.inviteExpiresAt}
            lineUserId={emp.user.lineUserId}
            baseUrl={baseUrl}
          />
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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success-deep">
        <span aria-hidden="true">✅</span>
        LINE เชื่อมแล้ว
      </span>
    );
  }
  if (authUserId) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-400/20 px-3 py-1 text-xs font-medium text-accent-600">
        <span aria-hidden="true">⏳</span>
        รอเชื่อม LINE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-ink-3">
      <span aria-hidden="true">📩</span>
      ยังไม่ได้ส่งลิงก์
    </span>
  );
}
