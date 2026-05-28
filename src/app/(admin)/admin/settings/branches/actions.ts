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

/**
 * Latitude / longitude come in as strings from the GeofencePicker's
 * hidden inputs. Empty string = "admin cleared the pin" → null.
 * Bounds: lat ∈ [-90, 90], lng ∈ [-180, 180].
 */
const coordSchema = (kind: 'lat' | 'lng') =>
  z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s || s.trim() === '') return null;
      const n = Number(s);
      const bound = kind === 'lat' ? 90 : 180;
      if (!Number.isFinite(n) || n < -bound || n > bound) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${kind} ไม่ถูกต้อง`,
        });
        return z.NEVER;
      }
      return n;
    });

const BranchSchema = z
  .object({
    name: z.string().trim().min(1, 'กรุณากรอกชื่อสาขา').max(80, 'ชื่อยาวเกินไป'),
    address: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((s) => (s ? s : null)),
    latitude: coordSchema('lat'),
    longitude: coordSchema('lng'),
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
    requireGps: z
      .string()
      .optional()
      .transform((s) => s === 'on'),
  })
  .refine((d) => (d.latitude == null) === (d.longitude == null), {
    message: 'ต้องระบุพิกัดทั้ง lat และ lng หรือทั้งคู่ว่าง',
    path: ['latitude'],
  });

function readForm(formData: FormData) {
  // Coerce missing keys (formData.get returns null) to undefined so the
  // schema's `.optional()` handles them. Without this, the GeofencePicker
  // case where no pin has been dropped (hidden lat/lng inputs not in the
  // DOM at all) makes Zod fail with "expected string, received null".
  // The pre-existing `transform(s => s.trim() === '' ? null : ...)` then
  // correctly maps the absent fields to null pin / no-geofence semantics.
  const get = (k: string) => formData.get(k) ?? undefined;
  return BranchSchema.safeParse({
    name: get('name'),
    address: get('address'),
    latitude: get('latitude'),
    longitude: get('longitude'),
    radiusMeters: get('radiusMeters'),
    requireSelfie: get('requireSelfie'),
    requireGps: get('requireGps'),
  });
}

export async function createBranch(formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/branches/new?error=${encodeURIComponent(msg)}`);
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
      redirect(`/admin/settings/branches/new?error=${encodeURIComponent('มีสาขาชื่อนี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/settings/branches');
  redirect('/admin/settings/branches');
}

export async function updateBranch(id: string, formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/branches/${id}/edit?error=${encodeURIComponent(msg)}`);
  }

  const before = await prisma.branch.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/settings/branches?error=${encodeURIComponent('ไม่พบสาขา')}`);
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
      redirect(`/admin/settings/branches/${id}/edit?error=${encodeURIComponent('มีสาขาชื่อนี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/settings/branches');
  redirect('/admin/settings/branches');
}

export async function archiveBranch(id: string) {
  const { user } = await requireRole(['Admin']);

  const before = await prisma.branch.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/settings/branches?error=${encodeURIComponent('ไม่พบสาขา')}`);
  }
  if (before.archivedAt) {
    redirect('/admin/settings/branches'); // already archived; no-op
  }

  // Refuse if any active employee has this as home branch.
  const dependents = await prisma.employee.count({
    where: { branchId: id, archivedAt: null },
  });
  if (dependents > 0) {
    redirect(
      `/admin/settings/branches?error=${encodeURIComponent(`มีพนักงาน ${dependents} คนอยู่ในสาขานี้`)}`,
    );
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

  revalidatePath('/admin/settings/branches');
  redirect('/admin/settings/branches');
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
  requireGps: boolean;
  latitude: unknown;
  longitude: unknown;
}) {
  return {
    name: b.name,
    address: b.address,
    radiusMeters: b.radiusMeters,
    requireSelfie: b.requireSelfie,
    requireGps: b.requireGps,
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
