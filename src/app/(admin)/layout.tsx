import { Sidebar } from '@/components/admin/sidebar';
import { requireRole } from '@/lib/auth/require-role';

/**
 * Admin shell — sidebar + main content area.
 *
 * Authorization runs in this layout (NOT just on the pages) so any future
 * /admin/* page automatically gets the role check. `requireRole(['Admin'])`
 * throws notFound() for non-admins; the layout doesn't render at all
 * without an authenticated Admin session.
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['Admin']);

  return (
    <div className="flex min-h-dvh bg-gray-50">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
