import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/require-role';
import { ChangePasswordForm } from './change-password-form';

/**
 * Self-service profile page for Admin / Owner.
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
 * info. The role gate `['Admin', 'Owner']` enforces this.
 */
export default async function AdminProfilePage() {
  const { user } = await requireRole(['Admin', 'Owner']);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">โปรไฟล์ของฉัน</h1>
        <p className="mt-1 text-sm text-gray-500">ข้อมูลบัญชี + เปลี่ยนรหัสผ่าน</p>
      </div>

      {/* ─── Identity card (readonly) ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลบัญชี</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <Row label="อีเมล" value={user.email ?? '—'} />
          <Row
            label="บทบาท"
            value={<RoleBadge role={user.role === 'Owner' ? 'Owner' : 'Admin'} />}
          />
        </CardBody>
      </Card>

      {/* ─── Change password ──────────────────────────────────────────── */}
      <ChangePasswordForm />

      <p className="text-xs text-gray-500">
        ต้องการแก้ไขอีเมลหรือเปลี่ยนบทบาท — ติดต่อ Owner เพื่อจัดการให้ที่ ตั้งค่า → ทีมผู้ดูแล
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-b-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function RoleBadge({ role }: { role: 'Admin' | 'Owner' }) {
  if (role === 'Owner') {
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
        Owner
      </span>
    );
  }
  return (
    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
      Admin
    </span>
  );
}
