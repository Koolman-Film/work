import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { isLocale } from '@/lib/i18n/config';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { loadEmployeeFormOptions } from '../../_load-options';
import { archiveEmployee, deleteEmployee, updateEmployee } from '../../actions';
import { EmployeeForm } from '../../employee-form';
import { PairingCard } from '../../pairing-card';
import { AdminAccessSection } from './admin-access-section';
import { DangerActions } from './danger-actions';
import { EntitlementsSection } from './entitlements-section';
import { LocaleDefaultCard } from './locale-default-card';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; ok?: string; year?: string }>;

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { user } = await requirePermission('employee.read');
  const { id } = await params;
  const { error, ok, year: yearParam } = await searchParams;
  const currentYear = Number(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4),
  );
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const [emp, options, adminAssignment] = await Promise.all([
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
        defaultOtRateType: true,
        defaultOtRatePerHour: true,
        defaultOtMultiplier: true,
        status: true,
        canCheckIn: true,
        hasSso: true,
        hiredAt: true,
        photoKey: true,
        dateOfBirth: true,
        bankId: true,
        bankAccountNumber: true,
        bankAccountName: true,
        archivedAt: true,
        inviteToken: true,
        inviteExpiresAt: true,
        user: { select: { lineUserId: true, authUserId: true, locale: true } },
      },
    }),
    loadEmployeeFormOptions(),
    prisma.userRoleAssignment.findFirst({
      where: {
        user: { employee: { id } },
        role: { OR: [{ key: 'admin' }, { isSuperadmin: true }], archivedAt: null },
      },
      select: { id: true },
    }),
  ]);
  if (!emp) notFound();

  // Branch-scope enforcement: deny access if actor cannot act on this employee's branches.
  if (
    !canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.read'), [
      emp.branchId,
      ...emp.assignedBranchIds,
    ])
  ) {
    notFound();
  }

  // Scoped admins (non-global) cannot reassign branches — show read-only branch UI.
  const branchReadOnly = (await getPermittedBranches(user, 'employee.update')) !== 'all';

  const photoUrl = await resolveStoredImageUrl(emp.photoKey);

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
        employeeId={id}
        branchReadOnly={branchReadOnly}
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
          defaultOtRateType: emp.defaultOtRateType,
          defaultOtRatePerHour: emp.defaultOtRatePerHour ? String(emp.defaultOtRatePerHour) : null,
          defaultOtMultiplier: emp.defaultOtMultiplier ? String(emp.defaultOtMultiplier) : null,
          status: emp.status,
          canCheckIn: emp.canCheckIn,
          hasSso: emp.hasSso,
          hiredAt: emp.hiredAt.toISOString().slice(0, 10),
          dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.toISOString().slice(0, 10) : null,
          bankId: emp.bankId,
          bankAccountNumber: emp.bankAccountNumber,
          bankAccountName: emp.bankAccountName,
          photoKey: emp.photoKey,
          photoUrl,
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
          <div className="mt-6 space-y-6">
            <EntitlementsSection employeeId={id} year={year} />
            <AdminAccessSection employeeId={id} isAlreadyAdmin={adminAssignment !== null} />
            <LocaleDefaultCard
              employeeId={emp.id}
              currentLocale={isLocale(emp.user.locale) ? emp.user.locale : null}
            />
            <PairingCard
              employeeId={id}
              employeeName={`${emp.firstName} ${emp.lastName}`.trim()}
              inviteToken={emp.inviteToken}
              inviteExpiresAt={emp.inviteExpiresAt}
              lineUserId={emp.user.lineUserId}
              baseUrl={baseUrl}
            />
          </div>
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
