import { requirePermission } from '@/lib/auth/check-permission';

export default async function BranchesSettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('settings.branch.manage');
  return <>{children}</>;
}
