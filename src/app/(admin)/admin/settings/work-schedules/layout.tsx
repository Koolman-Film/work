import { requirePermission } from '@/lib/auth/check-permission';

export default async function WorkSchedulesSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermission('settings.work-schedule.manage');
  return <>{children}</>;
}
