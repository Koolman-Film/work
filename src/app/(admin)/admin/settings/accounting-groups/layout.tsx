import { requirePermission } from '@/lib/auth/check-permission';

export default async function AccountingGroupsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermission('settings.accounting-group.manage');
  return <>{children}</>;
}
