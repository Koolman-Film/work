import { PageHeader } from '@/components/ui/page-header';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { LineConnectPanel } from './line-connect-panel';

/**
 * /admin/settings/line — the one place an admin connects their LINE.
 *
 * Two flows behind a chooser (see LineConnectPanel):
 *   - self-pairing: bind User.lineUserId to a fresh LINE (admin-only), so admin
 *     LIFF pages resolve the session and the admin rich menu appears in chat.
 *   - merge: an admin whose LINE is already an employee unifies the two onto one
 *     account (combined menu).
 * Per-admin; Superadmin auto-elevates through requireRole(['Admin']).
 */
export default async function LineSettingsPage() {
  const { user } = await requireRole(['Admin']);
  // A pure admin (no Employee row) can offer the merge path; an admin who is
  // already an employee only sees self-pairing.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employee: { select: { id: true } } },
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="เชื่อมต่อ LINE"
        subtitle="เชื่อมบัญชีผู้ดูแลกับ LINE เพื่อใช้เมนูแอดมินในแชท OA และรับการแจ้งเตือน"
      />
      <div>
        {ADMIN_LINE_LINK_ENABLED ? (
          <LineConnectPanel paired={user.lineUserId != null} canMerge={me?.employee == null} />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-ink-3">
            ฟีเจอร์เชื่อมต่อ LINE สำหรับผู้ดูแลถูกปิดใช้งานชั่วคราว
          </div>
        )}
      </div>
    </div>
  );
}
