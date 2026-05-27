import { Sidebar } from '@/components/admin/sidebar';
import { Topbar } from '@/components/admin/topbar';
import { requireRole } from '@/lib/auth/require-role';

/**
 * Admin shell — sidebar + topbar + main content.
 *
 * Authorization runs in this layout (NOT just on the pages) so any future
 * /admin/* page automatically gets the role check. `requireRole(['Admin'])`
 * throws notFound() for non-admins; the layout doesn't render at all
 * without an authenticated Admin session.
 *
 * Layout per docs/v1/screens/navigation.md:140-213.
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(['Admin']);

  return (
    <div className="flex min-h-dvh bg-gray-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
