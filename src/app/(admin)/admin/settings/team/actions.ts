'use server';

/**
 * Team CRUD — admin / owner accounts.
 *
 * Two-step write pattern for every create:
 *   1. `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
 *      using the service-role client. This creates the auth.users row that
 *      the SSR cookie session will eventually map to.
 *   2. Inside one Prisma transaction:
 *      a. `prisma.user.create({ authUserId, email })` — application User row.
 *         `email` is duplicated on both sides because Supabase owns the
 *         credential while our Prisma row carries the identity + archive state.
 *      b. `prisma.userRoleAssignment.create(...)` — the assignment that
 *         confers tier. Without this, the new user can log in but every
 *         permission check denies them.
 *
 * Tier policy (mirrors what the form UI exposes):
 *   - Admin can create Admin only.
 *   - Superadmin can create Admin or Superadmin.
 *
 * Edit policy:
 *   - Admin can edit Admin (other Admins, including self with caveats).
 *   - Admin CANNOT edit Superadmin (canActOnRole refuses).
 *   - Superadmin can edit anyone.
 *   - Branch-scoped Admin can only edit Admins in their shared branch
 *     (canActOnUserScope; Phase 3.7).
 *
 * Archive policy:
 *   - Admin can archive Admin (not self, not Superadmin).
 *   - Superadmin can archive Admin or Superadmin (not self, not the last Superadmin).
 *
 * "Last Superadmin" guard (countActiveSuperadmins):
 *   - Counts distinct active users with any isSuperadmin role assignment.
 *     If the target is Superadmin and archiving them would leave zero,
 *     the action refuses. Without this guard, a single mis-click could
 *     lock everyone out of high-privilege operations until a developer
 *     re-seeds.
 *
 * Password handling:
 *   - Superadmin types the initial password on create. Min 8 chars (Supabase
 *     enforces this too; we surface the friendly Thai message).
 *   - `resetAdminPassword` calls `auth.admin.updateUserById(authUserId,
 *     { password })`. There's no "send-reset-link" flow — that requires
 *     SMTP plumbing we don't have in V1. Out-of-band sharing (LINE
 *     between owners) is the workflow.
 *
 * Auth-side vs. App-side archive:
 *   - Archive only touches `User.archivedAt`. We don't ban the auth.users
 *     row. `requireRole` rejects archived users at the app layer, which
 *     is sufficient — it's the same pattern as Employee.archivedAt.
 *     The auth.users row stays around so audit references to the
 *     archived admin still resolve to a real subject_id.
 */

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { canDo, requirePermission } from '@/lib/auth/check-permission';
import { canActOnRole, canActOnUserScope, canManageSystemRole } from '@/lib/auth/team-guards';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

// ─── Validation ────────────────────────────────────────────────────────────

const EmailSchema = z
  .string()
  .trim()
  .min(1, 'กรุณากรอกอีเมล')
  .max(120)
  // Cheap email shape check — Supabase will reject anything invalid on
  // its end too, but a friendly Thai error here is nicer than the raw
  // 422 from gotrue.
  .email('รูปแบบอีเมลไม่ถูกต้อง')
  .transform((s) => s.toLowerCase());

const PasswordSchema = z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').max(72, 'รหัสผ่านยาวเกินไป');

const RoleSchema = z.enum(['Admin', 'Superadmin']);

const CreateSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  role: RoleSchema,
});

const ResetPasswordSchema = z.object({
  password: PasswordSchema,
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function readRequestContext() {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;
  return { ip, userAgent };
}

/**
 * How many active (non-archived) Superadmin-tier users exist? Used by
 * the last-Superadmin guard. We always check *just before* the
 * mutation rather than caching, because the lookup is cheap and a
 * TOCTOU race between two concurrent Superadmin archives would
 * otherwise let the system drop to zero Superadmins.
 *
 * Phase 4 — counts users with at least one active isSuperadmin
 * assignment (the new authorization source). Pre-Phase-4 this was a
 * `role: 'Superadmin'` column filter. A user with multiple Superadmin
 * assignments still counts as one (Prisma's `some` with `count`
 * deduplicates at the user level).
 */
async function countActiveSuperadmins(): Promise<number> {
  return prisma.user.count({
    where: {
      archivedAt: null,
      roleAssignments: {
        some: { role: { isSuperadmin: true, archivedAt: null } },
      },
    },
  });
}

// canActOnRole and canActOnUserScope live in src/lib/auth/team-guards.ts
// so both this server-action module AND the edit page (Server Component)
// can import them without 'use server' export friction.

// ─── Create ────────────────────────────────────────────────────────────────

export async function createTeamMember(formData: FormData): Promise<void> {
  const { user: actor, tier: actorTier } = await requirePermission('team.create');

  const parsed = CreateSchema.safeParse({
    email: formData.get('email') ?? undefined,
    password: formData.get('password') ?? undefined,
    role: formData.get('role') ?? undefined,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/team/new?error=${encodeURIComponent(msg)}`);
  }

  const { email, password, role } = parsed.data;

  // Privilege escalation guard: an Admin cannot create an Superadmin.
  if (!canActOnRole(actorTier, role)) {
    redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่มีสิทธิ์สร้างบัญชี Superadmin')}`);
  }

  // Pre-check email uniqueness in our User table. (Supabase auth.users
  // also enforces unique email; the dual-check gives us a friendly Thai
  // message before we even talk to gotrue.)
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect(
      `/admin/settings/team/new?error=${encodeURIComponent('อีเมลนี้ถูกใช้แล้ว')}&email=${encodeURIComponent(email)}`,
    );
  }

  // Step 1: create the Supabase auth user.
  const sb = getSupabaseAdminClient();
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    console.error('[team.create] supabase auth createUser failed', createErr);
    redirect(
      `/admin/settings/team/new?error=${encodeURIComponent(
        createErr?.message ?? 'สร้างบัญชีไม่สำเร็จ',
      )}&email=${encodeURIComponent(email)}`,
    );
  }

  const authUserId = created.user.id;

  // Step 2: create our User row + the matching RoleAssignment in a
  // single transaction. The assignment is the canonical source of
  // authorization — tier is computed from it at read time. The
  // form-submitted `role` value is used only to decide WHICH
  // RoleDefinition to assign (admin vs superadmin).
  let newUserId: string;
  try {
    newUserId = await prisma.$transaction(async (tx) => {
      const dbUser = await tx.user.create({
        data: { authUserId, email },
        select: { id: true },
      });
      // Find the matching system role definition (admin or superadmin).
      const systemKey = role === 'Superadmin' ? 'superadmin' : 'admin';
      const roleDef = await tx.roleDefinition.findUnique({
        where: { key: systemKey },
        select: { id: true },
      });
      if (!roleDef) {
        // Shouldn't happen — system roles are seeded by migration 0009.
        // If it does, fail loud rather than create a no-permission user.
        throw new Error(`System role '${systemKey}' not found — DB seed corrupt?`);
      }
      // Global assignment (branchId=NULL) — admins created via this UI
      // are global by default. Branch-scoped assignments can be added
      // via the AssignmentsSection on the edit page.
      await tx.userRoleAssignment.create({
        data: { userId: dbUser.id, roleId: roleDef.id, branchId: null },
      });
      return dbUser.id;
    });
  } catch (err) {
    // If our DB-side write fails after auth created, we have a dangling
    // auth.users row. Roll back the Supabase side to keep state consistent.
    console.error(
      '[team.create] prisma user.create failed after auth.users created; rolling back auth user',
      err,
    );
    await sb.auth.admin.deleteUser(authUserId).catch((rollbackErr) => {
      console.error('[team.create] rollback failed — orphan auth user', {
        authUserId,
        email,
        rollbackErr,
      });
    });
    redirect(`/admin/settings/team/new?error=${encodeURIComponent('บันทึกบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง')}`);
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.create',
    entityType: 'User',
    entityId: newUserId,
    after: { email, role, authUserId },
    metadata: { ...ctx, source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/team');
  redirect('/admin/settings/team');
}

// updateTeamMemberRole removed in Phase 4.5. The legacy
// "บทบาทหลัก" card on the edit page that called this action was
// the last surviving consumer of User.role-as-write; tier is now
// always derived from UserRoleAssignment. Admins manage tier
// through the AssignmentsSection (add/remove assignment) instead
// of via a separate role-set form. The 'user.role-change' audit
// action is similarly retired — audit logs from roleAssignment
// create/delete carry the equivalent "tier changed" story.

// ─── Reset password ────────────────────────────────────────────────────────

export async function resetTeamMemberPassword(id: string, formData: FormData): Promise<void> {
  const { user: actor, tier: actorTier } = await requirePermission('team.password-reset');

  const parsed = ResetPasswordSchema.safeParse({
    password: formData.get('password') ?? undefined,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent(msg)}`);
  }

  // Fetch target + assignments — we need the assignments to compute
  // target's tier (Phase 4; replaces the legacy target.role read).
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      authUserId: true,
      archivedAt: true,
      roleAssignments: {
        select: {
          role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
        },
      },
    },
  });
  if (!target) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  const targetTier = computeTier(target.roleAssignments);
  // Team management is for Admin / Superadmin only — Staff or
  // no-tier users get the same "not found" treatment they got from
  // the old `target.role === 'Staff'` check.
  if (targetTier !== 'Admin' && targetTier !== 'Superadmin') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  if (target.archivedAt) {
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent('บัญชีนี้ถูกระงับแล้ว')}`);
  }
  if (!target.authUserId) {
    // Admin/Superadmin accounts should always have authUserId — they're
    // created via the same flow we wrote earlier. Bail loudly if not.
    redirect(
      `/admin/settings/team/${id}/edit?error=${encodeURIComponent(
        'บัญชีนี้ไม่มี Supabase auth user — ติดต่อทีมพัฒนา',
      )}`,
    );
  }

  if (!canActOnRole(actorTier, targetTier)) {
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์แก้ไขบัญชีนี้')}`);
  }
  if (!(await canActOnUserScope(actor.id, target.id))) {
    redirect(
      `/admin/settings/team/${id}/edit?error=${encodeURIComponent('บัญชีนี้อยู่นอกขอบเขตสาขาที่คุณดูแล')}`,
    );
  }

  const sb = getSupabaseAdminClient();
  const { error } = await sb.auth.admin.updateUserById(target.authUserId, {
    password: parsed.data.password,
  });
  if (error) {
    console.error('[team.reset-password] supabase updateUserById failed', error);
    redirect(
      `/admin/settings/team/${id}/edit?error=${encodeURIComponent(
        error.message || 'ตั้งรหัสผ่านไม่สำเร็จ',
      )}`,
    );
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.password-reset',
    entityType: 'User',
    entityId: id,
    // Never log the password itself, even hashed. Just record the
    // identity of the target.
    metadata: { ...ctx, source: 'admin-ui', targetEmail: target.email },
  });

  redirect(`/admin/settings/team/${id}/edit?notice=${encodeURIComponent('ตั้งรหัสผ่านใหม่เรียบร้อย')}`);
}

// ─── Archive ───────────────────────────────────────────────────────────────

export async function archiveTeamMember(id: string): Promise<void> {
  // Archive is a reversible state change (soft delete) — treated as
  // an update. team.delete is reserved for hard delete only.
  const { user: actor, tier: actorTier } = await requirePermission('team.update');

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      archivedAt: true,
      roleAssignments: {
        select: {
          role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
        },
      },
    },
  });
  if (!target) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  const targetTier = computeTier(target.roleAssignments);
  if (targetTier !== 'Admin' && targetTier !== 'Superadmin') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  if (target.archivedAt) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้ถูกระงับแล้ว')}`);
  }

  // No-self-archive: prevents the actor from accidentally locking
  // themselves out of the admin app mid-session.
  if (target.id === actor.id) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่สามารถระงับบัญชีตัวเองได้')}`);
  }

  if (!canActOnRole(actorTier, targetTier)) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่มีสิทธิ์ระงับบัญชีนี้')}`);
  }
  if (!(await canActOnUserScope(actor.id, target.id))) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้อยู่นอกขอบเขตสาขาที่คุณดูแล')}`);
  }

  // Last-Superadmin guard.
  if (targetTier === 'Superadmin') {
    const ownerCount = await countActiveSuperadmins();
    if (ownerCount <= 1) {
      redirect(
        `/admin/settings/team?error=${encodeURIComponent('ต้องมี Superadmin อย่างน้อย 1 บัญชีในระบบ')}`,
      );
    }
  }

  try {
    await prisma.user.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  } catch (err) {
    // Foreign-key violation surface — if this User has Employee rows
    // pointing at them (shouldn't happen for Admin/Superadmin; defensive).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      redirect(`/admin/settings/team?error=${encodeURIComponent('มีข้อมูลอ้างอิงบัญชีนี้อยู่ — ติดต่อทีมพัฒนา')}`);
    }
    throw err;
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.archive',
    entityType: 'User',
    entityId: id,
    before: { tier: targetTier, archivedAt: null },
    after: { archivedAt: new Date().toISOString() },
    metadata: { ...ctx, source: 'admin-ui', targetEmail: target.email },
  });

  revalidatePath('/admin/settings/team');
  redirect('/admin/settings/team');
}

// ─── Hard delete ───────────────────────────────────────────────────────────

/**
 * Hard-delete an admin/owner account.
 *
 * Removes the Prisma `User` row AND the `auth.users` row from Supabase.
 * Use this for genuinely-departed admins or for cleanup of test accounts;
 * for "I just want to revoke access," prefer `archiveTeamMember` which
 * keeps the row + audit history intact.
 *
 * What survives a hard delete:
 *   - `AuditLog.actorId` rows that referenced this user. There's no FK
 *     constraint (intentional per the schema comment), so the rows
 *     stay; the audit viewer will need to handle "actor unknown"
 *     gracefully when it renders.
 *
 * What gets cascaded:
 *   - `Notification.userId` has `onDelete: Cascade` — admin/owner
 *     notifications for this user are removed with them.
 *
 * What blocks the delete:
 *   - `Employee.userId` has `onDelete: Restrict` — but no Admin/Superadmin
 *     should have an Employee row pointing at them; if Prisma raises
 *     P2003 it's a data-integrity bug, surfaced as a friendly error.
 *
 * Safety rails (same as archive, plus): no need for the orphan-rollback
 * pattern of create because the delete is one-way — Prisma first (the
 * row that's safe to be alone if Supabase fails), Supabase auth second.
 * If Supabase fails, the auth.users row is orphaned: that user can't
 * log in anymore (no Prisma User → `requireRole` rejects) but a
 * developer should clean up via the Supabase dashboard.
 */
export async function deleteTeamMember(id: string): Promise<void> {
  const { user: actor, tier: actorTier } = await requirePermission('team.delete');

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      authUserId: true,
      roleAssignments: {
        select: {
          role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
        },
      },
    },
  });
  if (!target) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  const targetTier = computeTier(target.roleAssignments);
  if (targetTier !== 'Admin' && targetTier !== 'Superadmin') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }

  // No-self-delete: would lock the actor out mid-session.
  if (target.id === actor.id) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่สามารถลบบัญชีตัวเองได้')}`);
  }

  if (!canActOnRole(actorTier, targetTier)) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่มีสิทธิ์ลบบัญชีนี้')}`);
  }
  if (!(await canActOnUserScope(actor.id, target.id))) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้อยู่นอกขอบเขตสาขาที่คุณดูแล')}`);
  }

  // Last-Superadmin guard. Even hard-deleting the only Superadmin must not happen
  // — system would have no one to manage future admins.
  if (targetTier === 'Superadmin') {
    const ownerCount = await countActiveSuperadmins();
    if (ownerCount <= 1) {
      redirect(
        `/admin/settings/team?error=${encodeURIComponent('ต้องมี Superadmin อย่างน้อย 1 บัญชีในระบบ')}`,
      );
    }
  }

  // Snapshot for audit BEFORE the row vanishes. After the delete we
  // won't be able to recover email/tier from the now-missing User row.
  const auditSnapshot = {
    email: target.email,
    tier: targetTier,
    authUserId: target.authUserId,
  };

  // Step 1: Prisma. Cascades Notifications; restricts on Employee (which
  // won't be pointing at admin/owner users — defensive catch below).
  try {
    await prisma.user.delete({ where: { id: target.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2003') {
        redirect(
          `/admin/settings/team?error=${encodeURIComponent(
            'มีข้อมูลอ้างอิงบัญชีนี้อยู่ — ใช้ปุ่ม "ระงับบัญชี" แทน',
          )}`,
        );
      }
      if (err.code === 'P2025') {
        // Already deleted by a concurrent action.
        redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้ถูกลบไปแล้ว')}`);
      }
    }
    throw err;
  }

  // Step 2: Supabase auth.users. If this fails the auth row is orphaned,
  // but the user can no longer log in (Prisma side is gone). We log
  // loudly so a developer can clean up via the dashboard; we DO NOT
  // re-create the Prisma row to "restore consistency" because then the
  // delete would have been a no-op from the user's perspective.
  if (target.authUserId) {
    const sb = getSupabaseAdminClient();
    const { error: authErr } = await sb.auth.admin.deleteUser(target.authUserId);
    if (authErr) {
      console.error('[team.delete] supabase deleteUser failed — orphan auth.users row', {
        authUserId: target.authUserId,
        email: target.email,
        message: authErr.message,
      });
      // We don't redirect with an error — the Prisma delete succeeded
      // and that's what governs login access. Surface a soft warning
      // via the notice channel so the admin knows about the orphan.
    }
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.delete',
    entityType: 'User',
    entityId: id,
    before: auditSnapshot,
    metadata: { ...ctx, source: 'admin-ui', targetEmail: target.email },
  });

  revalidatePath('/admin/settings/team');
  redirect(
    `/admin/settings/team?notice=${encodeURIComponent(`ลบบัญชี ${target.email ?? id} ออกแล้ว`)}`,
  );
}

// ─── Role assignments (Phase 2b) ───────────────────────────────────────────

// syncLegacyUserRole removed in Phase 4.6 alongside the User.role
// column it kept in sync. Tier is computed from UserRoleAssignment
// at read time (see src/lib/auth/user-tier.ts); there's nothing to
// sync anymore.

/**
 * Add a role assignment to a user. Form payload:
 *   - roleId: RoleDefinition.id (UUID)
 *   - branchId: 'global' literal (= NULL) or Branch.id (UUID)
 *
 * Safety:
 *   - Only Superadmin can grant the 'superadmin' role.
 *   - DB unique constraint on (userId, roleId, branchId) prevents dupes;
 *     we catch P2002 and surface a friendly message.
 *   - Validates role + branch exist + aren't archived.
 *
 * After the assignment is added, the user's tier (computed by
 * computeTier from active assignments) reflects the new state on
 * the next request — no separate sync needed.
 */
export async function addRoleAssignment(userId: string, formData: FormData): Promise<void> {
  // Initial permission gate — actor holds role.assign SOMEWHERE.
  const { user: actor, tier: actorTier } = await requirePermission('role.assign');

  const roleId = String(formData.get('roleId') ?? '');
  const branchValue = String(formData.get('branchId') ?? 'global');
  const branchId = branchValue === 'global' ? null : branchValue;

  if (!roleId) {
    redirect(`/admin/settings/team/${userId}/edit?error=${encodeURIComponent('กรุณาเลือกบทบาท')}`);
  }

  const role = await prisma.roleDefinition.findUnique({ where: { id: roleId } });
  if (!role || role.archivedAt) {
    redirect(`/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ไม่พบบทบาทที่เลือก')}`);
  }

  // Only Superadmin can grant the Superadmin role. Privilege-escalation guard.
  if (role.isSuperadmin && actorTier !== 'Superadmin') {
    redirect(
      `/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin')}`,
    );
  }

  // Tier-conferring (system) roles can't be granted by a permission-only
  // (tier-null) or Staff actor — privilege-escalation guard.
  if (!canManageSystemRole(actorTier, role)) {
    redirect(
      `/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ')}`,
    );
  }

  // Phase 3.7 branch-scope check on the GRANT:
  //   - Granting a GLOBAL assignment (branchId=null) requires actor have
  //     global authority (Superadmin or a global role.assign).
  //   - Granting a BRANCH-scoped assignment requires actor have role.assign
  //     AT THAT BRANCH (or globally).
  // Without this, a branch-A Admin could "claim" any user by assigning
  // them Admin@anyBranch — lateral privilege escalation.
  if (branchId === null) {
    if (actorTier !== 'Superadmin') {
      // canDo with explicit-null ctx is treated as "any scope ok" by
      // Phase 3.1's compatibility rule (preserving non-migrated callers).
      // Here we WANT to require global authority, so we ask: does the
      // actor have a global (or Superadmin) role.assign assignment?
      // The simplest expression is "Superadmin role" since plain Admins
      // never hold a global role.assign unless explicitly granted via
      // a custom role — and even then, the customer can opt in.
      redirect(
        `/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์มอบบทบาทระดับทุกสาขา (Global)')}`,
      );
    }
  } else {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.archivedAt) {
      redirect(`/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ไม่พบสาขาที่เลือก')}`);
    }
    if (!(await canDo(actor, 'role.assign', { branchId }))) {
      redirect(
        `/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์มอบบทบาทในสาขานี้')}`,
      );
    }
  }

  // The target user must exist.
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }

  try {
    await prisma.userRoleAssignment.create({
      data: { userId, roleId, branchId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      redirect(
        `/admin/settings/team/${userId}/edit?error=${encodeURIComponent('ผู้ใช้นี้มีบทบาทนี้ในสาขาดังกล่าวอยู่แล้ว')}`,
      );
    }
    throw err;
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'roleAssignment.create',
    entityType: 'UserRoleAssignment',
    entityId: userId, // we don't know the assignment.id without a re-fetch
    after: { userId, roleId, roleKey: role.key, branchId },
    metadata: { ...ctx, source: 'admin-ui', targetEmail: target.email },
  });

  revalidatePath(`/admin/settings/team/${userId}/edit`);
  redirect(`/admin/settings/team/${userId}/edit?notice=${encodeURIComponent('เพิ่มบทบาทเรียบร้อย')}`);
}

/**
 * Remove a role assignment by its id. Safety:
 *   - Refuses if it would remove the only global 'superadmin' assignment
 *     across the whole system (last-Superadmin guard, system-wide).
 *   - Refuses if the actor is the target AND they only have one
 *     'superadmin' assignment (no self-demotion via this UI; they'd
 *     have to get another Superadmin to do it).
 *   - Permission: Admin can remove non-Superadmin assignments. Only
 *     Superadmin can remove Superadmin assignments.
 *
 * After removal, the user's tier (computed by computeTier) reflects
 * the new state on the next request. A user with zero active
 * assignments will return tier=null from requireRole and be treated
 * as unauthorized — but the last-Superadmin / no-self-demotion
 * guards above prevent reaching that state for actively-managed users.
 */
export async function removeRoleAssignment(assignmentId: string): Promise<void> {
  const { user: actor, tier: actorTier } = await requirePermission('role.assign');

  const assignment = await prisma.userRoleAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      role: { select: { key: true, isSuperadmin: true, isSystem: true, name: true } },
      user: { select: { id: true, email: true } },
    },
  });
  if (!assignment) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบรายการมอบหมาย')}`);
  }

  // Permission: Admin can't remove Superadmin assignments.
  if (assignment.role.isSuperadmin && actorTier !== 'Superadmin') {
    redirect(
      `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ต้องเป็น Superadmin เพื่อเอาบทบาท Superadmin ออก')}`,
    );
  }

  // Tier-conferring (system) roles can't be removed by a permission-only
  // (tier-null) or Staff actor — privilege-escalation guard.
  if (!canManageSystemRole(actorTier, assignment.role)) {
    redirect(
      `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อถอดบทบาทระบบ')}`,
    );
  }

  // Phase 3.7 branch-scope check on the REVOKE:
  //   - Removing a GLOBAL assignment (branchId=null) requires actor have
  //     global authority (Superadmin).
  //   - Removing a BRANCH-scoped assignment requires actor have role.assign
  //     AT THAT BRANCH (or globally).
  // Symmetric to addRoleAssignment.
  if (assignment.branchId === null) {
    if (actorTier !== 'Superadmin') {
      redirect(
        `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์เอาบทบาทระดับทุกสาขา (Global) ออก')}`,
      );
    }
  } else if (!(await canDo(actor, 'role.assign', { branchId: assignment.branchId }))) {
    redirect(
      `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์เอาบทบาทในสาขานี้ออก')}`,
    );
  }

  // Last-Superadmin guard: if this is the only global Superadmin assignment
  // in the entire system, refuse — otherwise nobody could manage admins.
  if (assignment.role.isSuperadmin && assignment.branchId === null) {
    const totalGlobalSuperadmins = await prisma.userRoleAssignment.count({
      where: { role: { isSuperadmin: true }, branchId: null },
    });
    if (totalGlobalSuperadmins <= 1) {
      redirect(
        `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ต้องมี Superadmin (ทุกสาขา) อย่างน้อย 1 รายการในระบบ')}`,
      );
    }
  }

  // No-self-demotion: actor can't remove their own Superadmin assignment.
  if (assignment.userId === actor.id && assignment.role.isSuperadmin) {
    redirect(
      `/admin/settings/team/${assignment.userId}/edit?error=${encodeURIComponent('ไม่สามารถถอดบทบาท Superadmin ของตัวเองได้ — ขอให้ Superadmin คนอื่นช่วย')}`,
    );
  }

  await prisma.userRoleAssignment.delete({ where: { id: assignmentId } });

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'roleAssignment.delete',
    entityType: 'UserRoleAssignment',
    entityId: assignmentId,
    before: {
      userId: assignment.userId,
      roleKey: assignment.role.key,
      branchId: assignment.branchId,
    },
    metadata: { ...ctx, source: 'admin-ui', targetEmail: assignment.user.email },
  });

  revalidatePath(`/admin/settings/team/${assignment.userId}/edit`);
  redirect(
    `/admin/settings/team/${assignment.userId}/edit?notice=${encodeURIComponent('เอาบทบาทออกเรียบร้อย')}`,
  );
}
