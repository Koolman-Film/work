/**
 * Owner shell — topbar + content, no sidebar.
 *
 * Phase-1 Owner has exactly one page (/owner), so a sidebar would be
 * empty chrome. We re-use the admin Topbar (`userLabel`-driven, no
 * admin-only logic in it) for visual consistency.
 *
 * The role gate runs in this layout — any future /owner/* page picks it
 * up automatically. Non-Owners (including Admins) get notFound().
 */

import { Topbar } from '@/components/admin/topbar';
import { requireRole } from '@/lib/auth/require-role';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(['Owner']);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <Topbar userLabel={user.email ?? 'Owner'} userId={user.id} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
