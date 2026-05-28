import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { requirePermission } from '@/lib/auth/check-permission';
import { canActOnRole, canActOnUserScope } from '@/lib/auth/team-guards';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
import {
  archiveTeamMember,
  deleteTeamMember,
  resetTeamMemberPassword,
  updateTeamMemberRole,
} from '../../actions';
import { AssignmentsSection } from './assignments-section';
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
  // tier is computed from the actor's assignments (Phase 4). Same
  // value the legacy user.role column held while it existed, now
  // derived from UserRoleAssignment rows.
  const { user: actor, tier: actorTier } = await requirePermission('team.update');

  // Fetch target + assignments in one query so we can compute their
  // tier the same way (Phase 4 — used to read target.role enum).
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      createdAt: true,
      archivedAt: true,
      roleAssignments: {
        select: {
          role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
        },
      },
    },
  });
  if (!target) notFound();
  if (target.archivedAt) notFound();

  const targetTier = computeTier(target.roleAssignments);
  // Team list is Admin + Superadmin only — Staff or no-tier users
  // don't belong on this page.
  if (targetTier !== 'Admin' && targetTier !== 'Superadmin') notFound();

  // Defense-in-depth UX shortcut. The action layer enforces these
  // same rules; we do them here too so the user gets a 404 instead of
  // rendering a form whose submit would silently fail.
  //   - Tier: Admin cannot edit Superadmin.
  //   - Branch: branch-scoped Admin cannot edit Admins outside their
  //     shared branch (Phase 3.7).
  if (!canActOnRole(actorTier, targetTier)) notFound();
  if (!(await canActOnUserScope(actor.id, target.id))) notFound();

  const isSelf = target.id === actor.id;

  // Role options the actor can grant. Superadmin can also create Superadmin;
  // Admin cannot, so they can demote an Admin's role? No, Admin can
  // only set role to Admin (no-op), which the server treats as a
  // no-op and bounces out. Keep the dropdown anyway so the UI is
  // consistent — but only with permitted options.
  const roleOptions: ReadonlyArray<'Admin' | 'Superadmin'> =
    actorTier === 'Superadmin' ? ['Admin', 'Superadmin'] : ['Admin'];

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

      {/* ─── Role assignments (Phase 2b — new model) ──────────────────── */}
      {/* actorTier is 'Admin' | 'Superadmin' here because team.update is
          not in Staff's default perms — but TS can't narrow that, so an
          explicit cast keeps the AssignmentsSection prop type strict. */}
      <AssignmentsSection
        userId={id}
        actorRole={actorTier as 'Admin' | 'Superadmin'}
        actorId={actor.id}
      />

      {/* ─── Legacy role enum ──────────────────────────────────────────
          The new assignment editor above is the primary model. This
          card stays for now because some legacy pages still gate on
          User.role directly (Phase 3 will retire it). The action keeps
          User.role in sync with the assignments automatically — admins
          rarely need to touch this card. */}
      <form action={updateRoleBound}>
        <Card>
          <CardHeader>
            <CardTitle>
              บทบาทหลัก{' '}
              <span className="text-xs font-normal text-gray-500">(legacy — sync อัตโนมัติ)</span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <FormField label="บทบาท" htmlFor="role">
              <select
                id="role"
                name="role"
                defaultValue={targetTier}
                className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              >
                {roleOptions.includes('Admin') && <option value="Admin">Admin</option>}
                {roleOptions.includes('Superadmin') && (
                  <option value="Superadmin">Superadmin</option>
                )}
              </select>
            </FormField>
            <p className="text-xs text-gray-500">
              ค่านี้ถูกอัปเดตอัตโนมัติให้ตรงกับสิทธิ์สูงสุดจากการมอบหมายด้านบน ไม่จำเป็นต้องแก้ด้วยมือยกเว้นกรณีพิเศษ
            </p>
          </CardBody>
          <CardFooter className="flex justify-end">
            <Button type="submit" variant="secondary">
              บันทึก
            </Button>
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
