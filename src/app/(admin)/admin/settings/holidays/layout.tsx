import { requirePermission } from '@/lib/auth/check-permission';

export default async function HolidaysSettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('settings.holiday.manage');
  return <>{children}</>;
}
