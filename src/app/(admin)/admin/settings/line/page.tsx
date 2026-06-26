import { PageHeader } from '@/components/ui/page-header';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { requireRole } from '@/lib/auth/require-role';
import { LinePairingCard } from './line-pairing-card';

/**
 * /admin/settings/line — self-serve LINE pairing for the logged-in admin.
 *
 * Pairing binds User.lineUserId to the admin's LINE account so admin LIFF
 * pages resolve their session and the admin rich menu appears in the OA chat.
 * The page is per-admin (each admin manages their own binding); Superadmin
 * auto-elevates through requireRole(['Admin']).
 */
export default async function LineSettingsPage() {
  const { user } = await requireRole(['Admin']);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="เชื่อมต่อ LINE"
        subtitle="เชื่อมบัญชีผู้ดูแลกับ LINE เพื่อใช้เมนูแอดมินในแชท OA และรับการแจ้งเตือน"
      />
      <div className="max-w-xl">
        {ADMIN_LINE_LINK_ENABLED ? (
          <LinePairingCard paired={user.lineUserId != null} />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-ink-3">
            ฟีเจอร์เชื่อมต่อ LINE สำหรับผู้ดูแลถูกปิดใช้งานชั่วคราว
          </div>
        )}
      </div>
    </div>
  );
}
