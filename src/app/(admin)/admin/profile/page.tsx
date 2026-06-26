import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { MergePromptCard } from '../_components/merge-prompt-card';
import { ChangePasswordForm } from './change-password-form';

/**
 * Self-service profile page for Admin / Superadmin.
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
 * info. The role gate `['Admin', 'Superadmin']` enforces this.
 */
export default async function AdminProfilePage() {
  // tier is computed from assignments by requireRole (Phase 4); we
  // use it directly here rather than re-reading user.role (legacy
  // column that's about to go away in Phase 4.6).
  const { user, tier } = await requireRole(['Admin', 'Superadmin']);

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
          <Row
            label="บทบาท"
            value={<RoleBadge role={tier === 'Superadmin' ? 'Superadmin' : 'Admin'} />}
          />
        </CardBody>
      </Card>

      {/* ─── Link employee account (pure admins only) ─────────────────── */}
      {isPureAdmin && <MergePromptCard dismissible={false} />}

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

function RoleBadge({ role }: { role: 'Admin' | 'Superadmin' }) {
  if (role === 'Superadmin') {
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
        Superadmin
      </span>
    );
  }
  return (
    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
      Admin
    </span>
  );
}
