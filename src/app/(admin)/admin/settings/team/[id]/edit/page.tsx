import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import {
  archiveTeamMember,
  deleteTeamMember,
  resetTeamMemberPassword,
  updateTeamMemberRole,
} from '../../actions';
import { DangerActions } from './danger-actions';

/**
 * Edit page for an admin/owner account.
 *
 * Three sections, each in its own Card / form so a Server Action submit
 * doesn't accidentally cross-pollinate (e.g., tapping "ระงับ" must not
 * also send a half-filled password reset).
 *
 *   1. Change role (Admin ↔ Superadmin — Admin actor can't see Superadmin option)
 *   2. Reset password (type new one, submit)
 *   3. Danger zone (archive)
 *
 * Server-enforced rules surface as redirect ?error= banners (the same
 * pattern as every other settings CRUD).
 */

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function EditTeamMemberPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user: actor } = await requireRole(['Admin', 'Superadmin']);

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      archivedAt: true,
    },
  });
  if (!target) notFound();
  if (target.archivedAt) notFound();
  if (target.role === 'Staff') notFound();

  // Admin actor cannot edit Superadmin — defense in depth on top of the
  // server actions' canActOnRole check.
  if (actor.role === 'Admin' && target.role === 'Superadmin') notFound();

  const isSelf = target.id === actor.id;

  // Role options the actor can grant. Superadmin can also create Superadmin;
  // Admin cannot, so they can demote an Admin's role? No, Admin can
  // only set role to Admin (no-op), which the server treats as a
  // no-op and bounces out. Keep the dropdown anyway so the UI is
  // consistent — but only with permitted options.
  const roleOptions: ReadonlyArray<'Admin' | 'Superadmin'> =
    actor.role === 'Superadmin' ? ['Admin', 'Superadmin'] : ['Admin'];

  const updateRoleBound = updateTeamMemberRole.bind(null, id);
  const resetPasswordBound = resetTeamMemberPassword.bind(null, id);
  const archiveBound = archiveTeamMember.bind(null, id);
  const deleteBound = deleteTeamMember.bind(null, id);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{target.email}</h2>
        <p className="mt-0.5 text-sm text-gray-500">แก้ไขบทบาท / รหัสผ่าน / ระงับบัญชี</p>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}
      {notice && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          {decodeURIComponent(notice)}
        </div>
      )}

      {/* ─── Role ──────────────────────────────────────────────────────── */}
      <form action={updateRoleBound}>
        <Card>
          <CardHeader>
            <CardTitle>บทบาท</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <FormField label="บทบาท" htmlFor="role">
              <select
                id="role"
                name="role"
                defaultValue={target.role}
                className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              >
                {roleOptions.includes('Admin') && <option value="Admin">Admin</option>}
                {roleOptions.includes('Superadmin') && (
                  <option value="Superadmin">Superadmin</option>
                )}
              </select>
            </FormField>
            <p className="text-xs text-gray-500">
              Admin: จัดการพนักงาน / การลา / เช็คอิน — Superadmin: สิทธิ์เต็มรวมจัดการผู้ดูแล
            </p>
          </CardBody>
          <CardFooter className="flex justify-end">
            <Button type="submit">บันทึก</Button>
          </CardFooter>
        </Card>
      </form>

      {/* ─── Reset password ───────────────────────────────────────────── */}
      <form action={resetPasswordBound}>
        <Card>
          <CardHeader>
            <CardTitle>ตั้งรหัสผ่านใหม่</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <FormField
              label="รหัสผ่านใหม่"
              htmlFor="password"
              required
              hint="อย่างน้อย 8 ตัวอักษร — ส่งให้เจ้าของบัญชีทาง LINE"
            >
              <Input
                id="password"
                name="password"
                type="text"
                required
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                className="font-mono"
              />
            </FormField>
            <p className="text-xs text-gray-500">
              ผู้ใช้ที่เปิดอยู่จะออกจากระบบทันทีเมื่อคุณบันทึก — ต้องล็อกอินใหม่ด้วยรหัสผ่านใหม่
            </p>
          </CardBody>
          <CardFooter className="flex justify-end">
            <Button type="submit" variant="secondary">
              ตั้งรหัสผ่านใหม่
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* ─── Danger zone ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-200 bg-red-50/30 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-700">พื้นที่อันตราย</p>
        <p className="mt-1 text-xs text-red-700/80">
          <strong>ระงับบัญชี</strong>: ปิดการเข้าใช้งาน — ข้อมูล Audit ยังเก็บไว้ กู้คืนได้ภายหลัง
          <br />
          <strong>ลบถาวร</strong>: ลบบัญชีออกจากระบบทั้งหมด (Supabase auth + database) — ย้อนกลับไม่ได้
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-600">
            {isSelf ? 'คุณไม่สามารถระงับหรือลบบัญชีตัวเองได้' : `จัดการบัญชี ${target.email}`}
          </p>
          <DangerActions
            archiveAction={archiveBound}
            deleteAction={deleteBound}
            email={target.email}
            isSelf={isSelf}
          />
        </div>
      </div>

      <div>
        <Link href="/admin/settings/team" className="text-sm text-gray-600 hover:text-gray-900">
          ← กลับไปรายการ
        </Link>
      </div>
    </div>
  );
}
