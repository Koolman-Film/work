'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

/**
 * Branch CRUD Server Actions.
 *
 * Conventions used here that we'll mirror in Department + AccountingGroup:
 *   - Zod schema for input validation at the top
 *   - `requireRole(['Admin'])` first thing in every mutation
 *   - On validation failure → redirect back with `?error=...` (server actions
 *     can't return rich state to plain HTML forms; query param is the
 *     simplest progressive-enhancement-friendly approach)
 *   - On success → `revalidatePath` the list, then redirect there
 *   - `auditLog()` for every mutation (fire-and-forget)
 */

const BranchSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อสาขา').max(80, 'ชื่อยาวเกินไป'),
  address: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => (s ? s : null)),
  radiusMeters: z
    .string()
    .optional()
    .transform((s) => {
      if (!s) return 150;
      const n = Number(s);
      return Number.isFinite(n) && n >= 50 && n <= 1000 ? n : 150;
    }),
  requireSelfie: z
    .string()
    .optional()
    .transform((s) => s === 'on'),
});

function readForm(formData: FormData) {
  return BranchSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address'),
    radiusMeters: formData.get('radiusMeters'),
    requireSelfie: formData.get('requireSelfie'),
  });
}

export async function createBranch(formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/branches/new?error=${encodeURIComponent(msg)}`);
  }

  try {
    const created = await prisma.branch.create({ data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'branch.create',
      entityType: 'Branch',
      entityId: created.id,
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/branches/new?error=${encodeURIComponent('มีสาขาชื่อนี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/branches');
  redirect('/admin/branches');
}

export async function updateBranch(id: string, formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/branches/${id}/edit?error=${encodeURIComponent(msg)}`);
  }

  const before = await prisma.branch.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/branches?error=${encodeURIComponent('ไม่พบสาขา')}`);
  }

  try {
    await prisma.branch.update({ where: { id }, data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'branch.update',
      entityType: 'Branch',
      entityId: id,
      before: serializableBranch(before),
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/branches/${id}/edit?error=${encodeURIComponent('มีสาขาชื่อนี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/branches');
  redirect('/admin/branches');
}

export async function archiveBranch(id: string) {
  const { user } = await requireRole(['Admin']);

  const before = await prisma.branch.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/branches?error=${encodeURIComponent('ไม่พบสาขา')}`);
  }
  if (before.archivedAt) {
    redirect('/admin/branches'); // already archived; no-op
  }

  // Refuse if any active employee has this as home branch.
  const dependents = await prisma.employee.count({
    where: { branchId: id, archivedAt: null },
  });
  if (dependents > 0) {
    redirect(`/admin/branches?error=${encodeURIComponent(`มีพนักงาน ${dependents} คนอยู่ในสาขานี้`)}`);
  }

  await prisma.branch.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'branch.archive',
    entityType: 'Branch',
    entityId: id,
    before: serializableBranch(before),
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/branches');
  redirect('/admin/branches');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Prisma Decimal / Date fields aren't JSON-serializable directly; flatten
 * to primitives for AuditLog.beforeValue.
 */
function serializableBranch(b: {
  name: string;
  address: string | null;
  radiusMeters: number;
  requireSelfie: boolean;
  latitude: unknown;
  longitude: unknown;
}) {
  return {
    name: b.name,
    address: b.address,
    radiusMeters: b.radiusMeters,
    requireSelfie: b.requireSelfie,
    // Decimal → string (or null)
    latitude: b.latitude ? String(b.latitude) : null,
    longitude: b.longitude ? String(b.longitude) : null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}
