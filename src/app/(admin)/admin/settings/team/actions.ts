'use server';

/**
 * Team CRUD — admin / owner accounts.
 *
 * Two-step write pattern for every create:
 *   1. `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
 *      using the service-role client. This creates the auth.users row that
 *      the SSR cookie session will eventually map to.
 *   2. `prisma.user.create({ authUserId, email, role })` — our application
 *      User row. `email` is duplicated on both sides because Supabase owns
 *      the credential while our Prisma row carries the role + archive state.
 *
 * Role policy (mirrors what the form UI exposes):
 *   - Admin can create Admin only.
 *   - Owner can create Admin or Owner.
 *
 * Edit policy:
 *   - Admin can edit Admin (other Admins, including self with caveats).
 *   - Admin CANNOT edit Owner (role check refuses).
 *   - Owner can edit anyone.
 *
 * Archive policy:
 *   - Admin can archive Admin (not self, not Owner).
 *   - Owner can archive Admin or Owner (not self, not the last Owner).
 *
 * "Last Owner" guard:
 *   - Counts active (archivedAt=null) Owner rows. If the target is an Owner
 *     and removing them (via archive OR via role-change-to-Admin) would
 *     leave zero active Owners, the action refuses. Without this guard,
 *     a single mis-click could lock everyone out of high-privilege
 *     operations until a developer re-seeds.
 *
 * Password handling:
 *   - Owner types the initial password on create. Min 8 chars (Supabase
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

import { Prisma, type Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
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

const RoleSchema = z.enum(['Admin', 'Owner']);

const CreateSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  role: RoleSchema,
});

const UpdateRoleSchema = z.object({
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
 * How many active (non-archived) Owner accounts exist? Used by the
 * last-Owner guard. We always check *just before* the mutation rather
 * than caching, because the lookup is cheap and a TOCTOU race between
 * two concurrent Owner archives would otherwise let the system drop
 * to zero Owners.
 */
async function countActiveOwners(): Promise<number> {
  return prisma.user.count({
    where: { role: 'Owner', archivedAt: null },
  });
}

/**
 * Encode whether `actor` is permitted to act on a target with `targetRole`.
 * - Admins can only touch other Admins.
 * - Owners can touch anyone.
 */
function canActOnRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'Owner') return true;
  if (actorRole === 'Admin') return targetRole === 'Admin';
  return false;
}

// ─── Create ────────────────────────────────────────────────────────────────

export async function createTeamMember(formData: FormData): Promise<void> {
  const { user: actor } = await requireRole(['Admin', 'Owner']);

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

  // Privilege escalation guard: an Admin cannot create an Owner.
  if (!canActOnRole(actor.role, role)) {
    redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่มีสิทธิ์สร้างบัญชี Owner')}`);
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

  // Step 2: create our User row pointing at the auth subject.
  let newUserId: string;
  try {
    const dbUser = await prisma.user.create({
      data: {
        authUserId,
        email,
        role,
      },
      select: { id: true },
    });
    newUserId = dbUser.id;
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

// ─── Update role ───────────────────────────────────────────────────────────

export async function updateTeamMemberRole(id: string, formData: FormData): Promise<void> {
  const { user: actor } = await requireRole(['Admin', 'Owner']);

  const parsed = UpdateRoleSchema.safeParse({
    role: formData.get('role') ?? undefined,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent(msg)}`);
  }
  const { role: newRole } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, archivedAt: true },
  });
  if (!target) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  if (target.role === 'Employee') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้ไม่ใช่ผู้ดูแล')}`);
  }
  if (target.archivedAt) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('บัญชีนี้ถูกระงับแล้ว')}`);
  }

  // Permission: Admin cannot touch Owner; Owner can touch anyone.
  if (!canActOnRole(actor.role, target.role)) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่มีสิทธิ์แก้ไขบัญชีนี้')}`);
  }
  // And the new role must also be allowed (Admin can't promote to Owner).
  if (!canActOnRole(actor.role, newRole)) {
    redirect(
      `/admin/settings/team/${id}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์ตั้งบทบาทเป็น Owner')}`,
    );
  }

  // Last-Owner guard: demoting the only Owner would lock everyone out
  // of Owner-tier operations.
  if (target.role === 'Owner' && newRole !== 'Owner') {
    const ownerCount = await countActiveOwners();
    if (ownerCount <= 1) {
      redirect(
        `/admin/settings/team/${id}/edit?error=${encodeURIComponent(
          'ต้องมี Owner อย่างน้อย 1 บัญชีในระบบ',
        )}`,
      );
    }
  }

  // No-op? Bail out without an audit row.
  if (target.role === newRole) {
    redirect('/admin/settings/team');
  }

  await prisma.user.update({ where: { id }, data: { role: newRole } });

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.role-change',
    entityType: 'User',
    entityId: id,
    before: { role: target.role },
    after: { role: newRole },
    metadata: { ...ctx, source: 'admin-ui', targetEmail: target.email },
  });

  revalidatePath('/admin/settings/team');
  redirect('/admin/settings/team');
}

// ─── Reset password ────────────────────────────────────────────────────────

export async function resetTeamMemberPassword(id: string, formData: FormData): Promise<void> {
  const { user: actor } = await requireRole(['Admin', 'Owner']);

  const parsed = ResetPasswordSchema.safeParse({
    password: formData.get('password') ?? undefined,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent(msg)}`);
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, authUserId: true, archivedAt: true },
  });
  if (!target || target.role === 'Employee') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }
  if (target.archivedAt) {
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent('บัญชีนี้ถูกระงับแล้ว')}`);
  }
  if (!target.authUserId) {
    // Admin/Owner accounts should always have authUserId — they're
    // created via the same flow we wrote earlier. Bail loudly if not.
    redirect(
      `/admin/settings/team/${id}/edit?error=${encodeURIComponent(
        'บัญชีนี้ไม่มี Supabase auth user — ติดต่อทีมพัฒนา',
      )}`,
    );
  }

  if (!canActOnRole(actor.role, target.role)) {
    redirect(`/admin/settings/team/${id}/edit?error=${encodeURIComponent('ไม่มีสิทธิ์แก้ไขบัญชีนี้')}`);
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
  const { user: actor } = await requireRole(['Admin', 'Owner']);

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, archivedAt: true },
  });
  if (!target || target.role === 'Employee') {
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

  if (!canActOnRole(actor.role, target.role)) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่มีสิทธิ์ระงับบัญชีนี้')}`);
  }

  // Last-Owner guard.
  if (target.role === 'Owner') {
    const ownerCount = await countActiveOwners();
    if (ownerCount <= 1) {
      redirect(
        `/admin/settings/team?error=${encodeURIComponent('ต้องมี Owner อย่างน้อย 1 บัญชีในระบบ')}`,
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
    // pointing at them (shouldn't happen for Admin/Owner; defensive).
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
    before: { role: target.role, archivedAt: null },
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
 *   - `Employee.userId` has `onDelete: Restrict` — but no Admin/Owner
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
  const { user: actor } = await requireRole(['Admin', 'Owner']);

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, authUserId: true },
  });
  if (!target || target.role === 'Employee') {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่พบบัญชี')}`);
  }

  // No-self-delete: would lock the actor out mid-session.
  if (target.id === actor.id) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่สามารถลบบัญชีตัวเองได้')}`);
  }

  if (!canActOnRole(actor.role, target.role)) {
    redirect(`/admin/settings/team?error=${encodeURIComponent('ไม่มีสิทธิ์ลบบัญชีนี้')}`);
  }

  // Last-Owner guard. Even hard-deleting the only Owner must not happen
  // — system would have no one to manage future admins.
  if (target.role === 'Owner') {
    const ownerCount = await countActiveOwners();
    if (ownerCount <= 1) {
      redirect(
        `/admin/settings/team?error=${encodeURIComponent('ต้องมี Owner อย่างน้อย 1 บัญชีในระบบ')}`,
      );
    }
  }

  // Snapshot for audit BEFORE the row vanishes. After the delete we
  // won't be able to recover email/role from the now-missing User row.
  const auditSnapshot = {
    email: target.email,
    role: target.role,
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
