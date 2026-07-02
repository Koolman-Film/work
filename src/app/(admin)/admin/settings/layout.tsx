import { requireAdminArea } from '@/lib/auth/admin-area';
import { SettingsNav } from './settings-nav';

/**
 * Settings layout — a sticky sub-nav (vertical sidebar on lg+, horizontal
 * scroll strip on mobile) beside the entity pages, which own their own
 * PageHeader + content padding.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { permissions } = await requireAdminArea();
  return (
    <div className="lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-gray-100 px-4 py-4 sm:px-6 lg:sticky lg:top-4 lg:self-start lg:border-b-0 lg:px-4 lg:py-6">
        <SettingsNav allowedPermissions={[...permissions]} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
