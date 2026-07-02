import { requirePermission } from '@/lib/auth/check-permission';

export default async function LeaveTypesSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermission('settings.leave-type.manage');
  return <>{children}</>;
}
