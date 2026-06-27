import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { prisma } from '@/lib/db/prisma';
import { MergePromptCard } from '../_components/merge-prompt-card';
import { ChangePasswordForm } from './change-password-form';

/**
 * Self-service profile page for any admin-area user (Admin, Superadmin, or
 * custom-role back-office user).
 *
 * V1 scope is intentionally minimal:
 *   - Show who you're logged in as (email + role badge — both readonly
 *     because changing email is a multi-step Supabase flow we haven't
 *     implemented and changing role would be a self-service privilege
 *     escalation we never want to allow)
 *   - Change-password form
 *
 * Employees are NOT routed here. They authenticate via LINE OIDC (no
 * Supabase password), and they already have /liff/profile for contact
 * info. requireAdminArea() enforces back-office access.
 */
export default async function AdminProfilePage() {
  // tier is computed from assignments by requireAdminArea; null means
  // the user holds a custom role (no system tier).
  const { user, tier } = await requireAdminArea();

  // Pure admins (no Employee row) can link an employee account here. This is
  // the PERMANENT entry point — the dashboard nudge is dismissible one-way, so
  // the profile must always offer the door regardless of mergePromptDismissedAt.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employee: { select: { id: true } } },
  });
  const isPureAdmin = me?.employee == null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="โปรไฟล์ของฉัน" subtitle="ข้อมูลบัญชี + เปลี่ยนรหัสผ่าน" />

      {/* ─── Identity card (readonly) ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลบัญชี</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <Row label="อีเมล" value={user.email ?? '—'} />
          <Row label="บทบาท" value={<RoleBadge tier={tier} />} />
        </CardBody>
      </Card>

      {/* ─── Link employee account (pure admins only) ─────────────────── */}
      {/* Hidden while the admin LINE experience is disabled (ADMIN_LINE_LINK_ENABLED). */}
      {ADMIN_LINE_LINK_ENABLED && isPureAdmin && <MergePromptCard dismissible={false} />}

      {/* ─── Change password ──────────────────────────────────────────── */}
      <ChangePasswordForm />

      <p className="text-xs text-ink-3">
        ต้องการแก้ไขอีเมลหรือเปลี่ยนบทบาท — ติดต่อ Superadmin เพื่อจัดการให้ที่ ตั้งค่า → ทีมผู้ดูแล
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-b-0">
      <span className="text-sm text-ink-3">{label}</span>
      <span className="text-sm font-medium text-ink-1">{value}</span>
    </div>
  );
}

function RoleBadge({ tier }: { tier: 'Admin' | 'Superadmin' | 'Staff' | null }) {
  if (tier === 'Superadmin')
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
        Superadmin
      </span>
    );
  if (tier === 'Admin')
    return (
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
        Admin
      </span>
    );
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      บทบาทกำหนดเอง
    </span>
  );
}
