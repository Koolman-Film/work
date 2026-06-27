import { requirePermission } from '@/lib/auth/check-permission';

export default async function DepartmentsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermission('settings.department.manage');
  return <>{children}</>;
}
