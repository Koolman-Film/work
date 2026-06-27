import { Sidebar } from '@/components/admin/sidebar';
import { Topbar } from '@/components/admin/topbar';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { prisma } from '@/lib/db/prisma';

/**
 * Admin shell — sidebar + topbar + main content.
 *
 * Authorization runs in this layout (NOT just on the pages) so any future
 * /admin/* page automatically gets the admission check. `requireAdminArea()`
 * admits Admin/Superadmin tiers AND any custom-role user who holds at least
 * one back-office permission. It throws notFound() for everyone else; the
 * layout doesn't render at all without an authenticated session that passes
 * the gate.
 *
 * The resulting permission set is forwarded to `<Sidebar>` so it can hide
 * nav items the user is not permitted to access, without a second auth call.
 *
 * Layout per docs/v1/screens/navigation.md:140-213.
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, permissions } = await requireAdminArea();

  // Pending-work counts for the sidebar badges. Counted per request — the
  // layout re-renders on every admin navigation, so the numbers stay fresh
  // without any client-side polling.
  const [leave, advance, attendance] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending' } }),
    prisma.cashAdvance.count({ where: { status: 'Pending' } }),
    prisma.attendance.count({ where: { type: 'CheckIn', checkInStatus: 'Disputed' } }),
  ]);

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar badges={{ leave, advance, attendance }} allowedPermissions={[...permissions]} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
