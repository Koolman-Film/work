import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { canActOnRole, canActOnUserScope } from '@/lib/auth/team-guards';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
import { archiveTeamMember, deleteTeamMember, resetTeamMemberPassword } from '../../actions';
import { AssignmentsSection } from './assignments-section';
import { DangerActions } from './danger-actions';

/**
 * Edit page for an admin/owner account.
 *
 * Two sections, each in its own Card / form so a Server Action submit
 * doesn't accidentally cross-pollinate (e.g., tapping "ระงับ" must not
 * also send a half-filled password reset).
 *
 *   1. AssignmentsSection — add/remove role assignments. This is the
 *      canonical "what this user can do" surface (Phase 2b).
 *   2. Reset password (type new one, submit)
 *   3. Danger zone (archive / hard delete)
 *
 * Server-enforced rules surface as redirect ?error= banners (the same
 * pattern as every other settings CRUD).
 *
 * Phase 4.5 removed the legacy "บทบาทหลัก" (User.role enum) card —
 * tier is computed from assignments now, so editing it directly
 * doesn't make sense.
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
  // tier is computed from the actor's assignments by requirePermission.
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

  const resetPasswordBound = resetTeamMemberPassword.bind(null, id);
  const archiveBound = archiveTeamMember.bind(null, id);
  const deleteBound = deleteTeamMember.bind(null, id);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า · ทีมผู้ดูแล"
        title={target.email ?? 'แก้ไขผู้ดูแล'}
        subtitle="แก้ไขบทบาท / รหัสผ่าน / ระงับบัญชี"
      />
      <div className="max-w-2xl space-y-6">
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep"
          >
            {decodeURIComponent(error)}
          </div>
        )}
        {notice && (
          <div className="rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep">
            {decodeURIComponent(notice)}
          </div>
        )}

        {/* ─── Role assignments (Phase 2b — new model) ──────────────────── */}
        {/* actorTier may be null for a custom-role user who holds team.update.
          Treat tier-less actors as Admin-level for the assignment UI's
          Superadmin-hiding logic; the server action re-checks every grant. */}
        <AssignmentsSection
          userId={id}
          actorRole={actorTier === 'Superadmin' ? 'Superadmin' : 'Admin'}
          actorId={actor.id}
        />

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
          <Link href="/admin/settings/team" className="text-sm text-ink-3 hover:text-ink-1">
            ← กลับไปรายการ
          </Link>
        </div>
      </div>
    </div>
  );
}
