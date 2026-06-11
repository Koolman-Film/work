import { Sidebar } from '@/components/admin/sidebar';
import { Topbar } from '@/components/admin/topbar';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

/**
 * Admin shell — sidebar + topbar + main content.
 *
 * Authorization runs in this layout (NOT just on the pages) so any future
 * /admin/* page automatically gets the role check. `requireRole(['Admin',
 * 'Superadmin'])` throws notFound() for everyone else; the layout doesn't
 * render at all without an authenticated Admin/Superadmin session.
 *
 * History: this used to accept only `['Admin']`. After the Phase 1 role
 * rename, Superadmin (formerly Superadmin) was supposed to be routed to /admin
 * by the home-page router — but THIS gate still only let Admins through,
 * so Superadmins got 404'd at the shell. Fixed 2026-05-28.
 *
 * Layout per docs/v1/screens/navigation.md:140-213.
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(['Admin', 'Superadmin']);

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
      <Sidebar badges={{ leave, advance, attendance }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
