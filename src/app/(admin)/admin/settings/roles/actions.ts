'use server';

/**
 * RoleDefinition CRUD — manage custom roles + tune system role permissions.
 *
 * System role semantics:
 *   - The three system roles (superadmin / admin / staff) have `isSystem=true`
 *     and `isSuperadmin` set per their definition. Customers can edit the
 *     permission list to fit their workflows (e.g. "our Admin role shouldn't
 *     approve advances") but cannot delete them, rename the `key`, or flip
 *     the `isSuperadmin` flag.
 *   - User-created roles (`isSystem=false`) are fully editable, including
 *     name + description. The `key` is auto-generated from the name on
 *     create (slugified) and is immutable thereafter — changing it would
 *     orphan all existing UserRoleAssignment rows via the role lookup.
 *
 * Permissions list validation:
 *   - Every entry must be a known key from PERMISSIONS (src/lib/auth/permissions.ts).
 *   - Unknown keys are silently dropped (defensive — the catalog is the
 *     source of truth; a stale permission key would just be ignored at
 *     check time anyway, so we strip it at write time too).
 *
 * Archive safety:
 *   - Refuse if any non-archived UserRoleAssignment references the role.
 *     Admin must reassign affected users first.
 *   - System roles can't be archived at all. The customer can edit them
 *     to grant fewer permissions, but the role row itself stays around.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { isPermission, type Permission } from '@/lib/auth/permissions';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

// ─── Validation ────────────────────────────────────────────────────────────

const NameSchema = z.string().trim().min(1, 'กรุณากรอกชื่อบทบาท').max(60, 'ชื่อยาวเกินไป');
const DescriptionSchema = z
  .string()
  .trim()
  .max(500, 'คำอธิบายยาวเกินไป')
  .optional()
  .transform((s) => (s && s.length > 0 ? s : null));

/**
 * Parse the `permissions` form field (checkbox values arrive as repeated
 * keys). Drop any that aren't in the live catalog.
 */
function readPermissions(formData: FormData): Permission[] {
  const raw = formData.getAll('permissions').map(String);
  return raw.filter(isPermission);
}

/**
 * Slugify a role name into a stable key: lowercase, alphanumeric +
 * dashes, max 32 chars. Multiple consecutive dashes collapsed.
 *
 * Used only on create. The `key` is immutable after that.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

// ─── Create ────────────────────────────────────────────────────────────────

export async function createRole(formData: FormData): Promise<void> {
  const { user } = await requireRole(['Superadmin']);

  const nameResult = NameSchema.safeParse(formData.get('name'));
  if (!nameResult.success) {
    redirect(
      `/admin/settings/roles/new?error=${encodeURIComponent(nameResult.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }
  const descResult = DescriptionSchema.safeParse(formData.get('description'));
  if (!descResult.success) {
    redirect(
      `/admin/settings/roles/new?error=${encodeURIComponent(descResult.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const permissions = readPermissions(formData);

  let key = slugify(nameResult.data);
  if (!key) {
    redirect(`/admin/settings/roles/new?error=${encodeURIComponent('ชื่อบทบาทต้องมีตัวอักษร a-z 0-9')}`);
  }

  // Ensure key uniqueness — if the slug collides with an existing role,
  // append a numeric suffix. The base key + `-2`, `-3`, etc.
  let attemptKey = key;
  let suffix = 1;
  while (await prisma.roleDefinition.findUnique({ where: { key: attemptKey } })) {
    suffix += 1;
    attemptKey = `${key}-${suffix}`;
  }
  key = attemptKey;

  const created = await prisma.roleDefinition.create({
    data: {
      key,
      name: nameResult.data,
      description: descResult.data,
      permissions,
      isSuperadmin: false, // custom roles can never be superadmin
      isSystem: false,
    },
  });

  auditLog({
    actorId: user.id,
    action: 'role.create',
    entityType: 'RoleDefinition',
    entityId: created.id,
    after: {
      key: created.key,
      name: created.name,
      permissions,
    },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/roles');
  redirect('/admin/settings/roles');
}

// ─── Update ────────────────────────────────────────────────────────────────

export async function updateRole(id: string, formData: FormData): Promise<void> {
  const { user } = await requireRole(['Superadmin']);

  const before = await prisma.roleDefinition.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/settings/roles?error=${encodeURIComponent('ไม่พบบทบาท')}`);
  }
  if (before.archivedAt) {
    redirect(`/admin/settings/roles?error=${encodeURIComponent('บทบาทนี้ถูกระงับแล้ว')}`);
  }

  const nameResult = NameSchema.safeParse(formData.get('name'));
  if (!nameResult.success) {
    redirect(
      `/admin/settings/roles/${id}/edit?error=${encodeURIComponent(nameResult.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }
  const descResult = DescriptionSchema.safeParse(formData.get('description'));
  if (!descResult.success) {
    redirect(
      `/admin/settings/roles/${id}/edit?error=${encodeURIComponent(descResult.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const permissions = readPermissions(formData);

  // System role guards: name + description editable; permissions editable;
  // key + isSystem + isSuperadmin locked. The form should not even render
  // the locked fields, but we re-check at the action boundary.
  await prisma.roleDefinition.update({
    where: { id },
    data: {
      name: nameResult.data,
      description: descResult.data,
      permissions,
      // Explicitly NOT setting: key, isSystem, isSuperadmin.
    },
  });

  auditLog({
    actorId: user.id,
    action: 'role.update',
    entityType: 'RoleDefinition',
    entityId: id,
    before: {
      name: before.name,
      description: before.description,
      permissions: before.permissions,
    },
    after: {
      name: nameResult.data,
      description: descResult.data,
      permissions,
    },
    metadata: { source: 'admin-ui', isSystem: before.isSystem },
  });

  revalidatePath('/admin/settings/roles');
  revalidatePath(`/admin/settings/roles/${id}/edit`);
  redirect('/admin/settings/roles');
}

// ─── Archive ───────────────────────────────────────────────────────────────

export async function archiveRole(id: string): Promise<void> {
  const { user } = await requireRole(['Superadmin']);

  const before = await prisma.roleDefinition.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/settings/roles?error=${encodeURIComponent('ไม่พบบทบาท')}`);
  }
  if (before.archivedAt) {
    redirect('/admin/settings/roles'); // already archived; no-op
  }

  // System roles can never be archived — they're load-bearing.
  if (before.isSystem) {
    redirect(`/admin/settings/roles?error=${encodeURIComponent('ไม่สามารถระงับบทบาทระบบได้')}`);
  }

  // Refuse if any active assignment references this role.
  const usage = await prisma.userRoleAssignment.count({
    where: { roleId: id },
  });
  if (usage > 0) {
    redirect(
      `/admin/settings/roles?error=${encodeURIComponent(
        `มีผู้ใช้ ${usage} รายการได้รับมอบบทบาทนี้อยู่ — เปลี่ยนบทบาทของผู้ใช้ก่อน`,
      )}`,
    );
  }

  await prisma.roleDefinition.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  auditLog({
    actorId: user.id,
    action: 'role.archive',
    entityType: 'RoleDefinition',
    entityId: id,
    before: { name: before.name, key: before.key },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/roles');
  redirect('/admin/settings/roles');
}
