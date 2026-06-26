/**
 * /liff/profile — employee self-service profile (S-E11 per docs/v1/screens/employee.md).
 *
 * This Server Component only fetches data and hands it to the presentational
 * <ProfileView> (a client component shared with the i18n preview route). All
 * visible chrome is localized inside ProfileView via next-intl; salary IS shown
 * to the employee (Thai labor convention — they signed the contract).
 */

import { requireEmployee } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { ProfileView } from './profile-view';

export default async function LiffProfilePage() {
  const { employee } = await requireEmployee();

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
      photoKey: true,
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

  // Admin-managed photo; page renders per-request so the signed URL is fresh.
  const photoUrl = await resolveStoredImageUrl(fullEmployee.photoKey);

  return (
    <ProfileView
      employee={{
        firstName: fullEmployee.firstName,
        lastName: fullEmployee.lastName,
        nickname: fullEmployee.nickname,
        photoUrl,
        shortId: fullEmployee.id.slice(0, 8),
        branchName: fullEmployee.branch.name,
        departmentName: fullEmployee.department?.name ?? null,
        salaryType: fullEmployee.salaryType,
        baseSalary: fullEmployee.baseSalary.toString(),
        hiredAt: fullEmployee.hiredAt.toISOString(),
      }}
      initial={{
        nickname: fullEmployee.nickname,
        phone: fullEmployee.phone,
        personalEmail: fullEmployee.personalEmail,
        address: fullEmployee.address,
        emergencyContact: fullEmployee.emergencyContact,
      }}
    />
  );
}
