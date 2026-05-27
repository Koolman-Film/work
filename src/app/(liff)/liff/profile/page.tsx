/**
 * /liff/profile — employee self-service profile (S-E11 per docs/v1/screens/employee.md).
 *
 * Layout:
 *   - Header card: full name, nickname (if any), employee ID short prefix,
 *     branch + department line
 *   - Edit-section (form): nickname, phone, personal email, address,
 *     emergency contact — all optional, all editable
 *   - Read-only section: position (department), branch, salary, hire date
 *     — admin-managed; spec text "ติดต่อ Admin หากต้องแก้"
 *
 * Single-form pattern (Save button at bottom) rather than per-field
 * inline-edit (the spec wireframe shows inline). Single form is ~30% the
 * code and matches /liff/leave/new + /liff/advance/new which employees
 * already know. Inline-edit can be a UX polish item once we have user
 * feedback.
 *
 * baseSalary IS displayed to the employee — Thai labor convention is
 * that the employee signed the contract and knows their salary. Hiding
 * it would just generate "what's my salary?" support questions.
 */

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { ProfileForm } from './profile-form';

const SALARY_TYPE_LABEL: Record<string, string> = {
  Monthly: 'รายเดือน',
  Daily: 'รายวัน',
  Hourly: 'รายชั่วโมง',
};

function formatMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function LiffProfilePage() {
  const { employee } = await requireRole(['Employee']);
  if (!employee) throw new Error('requireRole did not return Employee');

  // Re-fetch to pick up branch + department names (requireRole only returns
  // the bare Employee row). One round-trip; pages don't run often.
  const fullEmployee = await prisma.employee.findUnique({
    where: { id: employee.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      phone: true,
      personalEmail: true,
      address: true,
      emergencyContact: true,
      salaryType: true,
      baseSalary: true,
      hiredAt: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  });
  if (!fullEmployee) {
    throw new Error('Employee row vanished between auth + read — race condition?');
  }

  const displayName =
    fullEmployee.nickname && fullEmployee.nickname.trim().length > 0
      ? fullEmployee.nickname
      : fullEmployee.firstName;
  const initials = (displayName[0] ?? '?').toUpperCase();
  const shortId = fullEmployee.id.slice(0, 8);

  return (
    <main className="mx-auto max-w-md px-4 pt-6 pb-12">
      {/* Header — identity card */}
      <Card className="mb-4">
        <CardBody className="!py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary-100 text-lg font-bold text-primary-700">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-gray-900">
                {fullEmployee.firstName} {fullEmployee.lastName}
                {fullEmployee.nickname && (
                  <span className="text-gray-500"> ({fullEmployee.nickname})</span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                EMP-{shortId} • {fullEmployee.branch.name}
                {fullEmployee.department && ` · ${fullEmployee.department.name}`}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Edit-section — form */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>ข้อมูลส่วนตัว</CardTitle>
        </CardHeader>
        <CardBody>
          <ProfileForm
            initial={{
              nickname: fullEmployee.nickname,
              phone: fullEmployee.phone,
              personalEmail: fullEmployee.personalEmail,
              address: fullEmployee.address,
              emergencyContact: fullEmployee.emergencyContact,
            }}
          />
        </CardBody>
      </Card>

      {/* Read-only — employment info */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            ข้อมูลงาน
            <span className="ml-2 text-xs font-normal text-gray-500">(ติดต่อแอดมินหากต้องแก้)</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <ReadOnlyRow label="สาขา" value={fullEmployee.branch.name} />
          <ReadOnlyRow label="แผนก" value={fullEmployee.department?.name ?? '—'} />
          <ReadOnlyRow
            label="ประเภทการจ่าย"
            value={SALARY_TYPE_LABEL[fullEmployee.salaryType] ?? fullEmployee.salaryType}
          />
          <ReadOnlyRow label="เงินเดือนพื้นฐาน" value={formatMoney(fullEmployee.baseSalary)} />
          <ReadOnlyRow label="วันเริ่มงาน" value={formatDate(fullEmployee.hiredAt)} />
        </CardBody>
      </Card>

      <nav className="mt-6 flex justify-center gap-4 text-xs">
        <a href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          ← กลับหน้าเช็คอิน
        </a>
      </nav>
    </main>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right text-sm text-gray-800">{value}</span>
    </div>
  );
}
