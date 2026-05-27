import { SettingsNav } from './settings-nav';

/**
 * Settings layout — two-column with a sticky side-tab nav.
 *
 * The outer admin layout already provides the topbar + sidebar; this
 * layout adds the inner side-nav for the Settings cluster.
 *
 * Per docs/v1/screens/admin.md:740-762.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">ตั้งค่า</h1>
        <p className="mt-1 text-sm text-gray-500">สาขา / แผนก / กลุ่มบัญชี และค่ากำหนดต่างๆ</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SettingsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
