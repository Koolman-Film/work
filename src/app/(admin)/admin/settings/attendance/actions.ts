'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { addBranchCutoff, removeBranchCutoff } from '@/lib/payroll/branch-cutoff-admin';

const Schema = z.object({
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลาไม่ถูกต้อง (HH:MM)'),
  // 0 = any minute past start counts as late; cap at 8h as a sanity bound.
  lateGraceMinutes: z.coerce.number().int().min(0).max(480),
  // Payroll cutoff day. Bounded 1–28 (matches payrollMonthWindow) so the
  // (cutoff+1) period start never overflows a short month. e.g. 26 → รอบ
  // 27 ของเดือนก่อน ถึง 26 ของเดือนนี้.
  cutoffDay: z.coerce.number().int().min(1).max(28),
  // Late-penalty policy (C9).
  lateThreeStrikeEnabled: z.boolean(),
  lateThreeStrikeCount: z.coerce.number().int().min(1).max(31),
  severeLateEnabled: z.boolean(),
  severeLateThresholdMin: z.coerce.number().int().min(0).max(480),
});

export async function updateAttendanceConfig(formData: FormData) {
  const { user } = await requirePermission('settings.attendance.manage');

  const parsed = Schema.safeParse({
    workStartTime: formData.get('workStartTime'),
    lateGraceMinutes: formData.get('lateGraceMinutes'),
    cutoffDay: formData.get('cutoffDay'),
    // Unchecked checkboxes are absent from FormData → false.
    lateThreeStrikeEnabled: formData.get('lateThreeStrikeEnabled') === 'on',
    lateThreeStrikeCount: formData.get('lateThreeStrikeCount'),
    severeLateEnabled: formData.get('severeLateEnabled') === 'on',
    severeLateThresholdMin: formData.get('severeLateThresholdMin'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/attendance?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  // PayrollConfig is a seeded singleton with many required fields, so we only
  // ever UPDATE it here (never create — that path belongs to the seed).
  const before = await prisma.payrollConfig.findFirst({
    select: { id: true, workStartTime: true, lateGraceMinutes: true, cutoffDay: true },
  });
  if (!before) {
    redirect(
      `/admin/settings/attendance?error=${encodeURIComponent('ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน')}`,
    );
  }

  await prisma.payrollConfig.update({ where: { id: before.id }, data: parsed.data });

  auditLog({
    actorId: user.id,
    action: 'payrollConfig.update',
    entityType: 'PayrollConfig',
    entityId: before.id,
    before: {
      workStartTime: before.workStartTime,
      lateGraceMinutes: before.lateGraceMinutes,
      cutoffDay: before.cutoffDay,
    },
    after: parsed.data,
    metadata: { source: 'admin-ui', section: 'attendance-late-policy' },
  });

  revalidatePath('/admin/settings/attendance');
  redirect('/admin/settings/attendance?ok=1');
}

const BranchCutoffSchema = z.object({
  branchId: z.string().uuid('กรุณาเลือกสาขา'),
  fromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'กรุณาเลือกเดือนที่เริ่มมีผล'),
  cutoffDay: z.coerce.number().int(),
});

const BRANCH_CUTOFF_ERRORS: Record<string, string> = {
  invalid: 'วันตัดรอบต้องเป็นวันที่ 1–28 หรือสิ้นเดือน',
  'branch-not-found': 'ไม่พบสาขา',
  duplicate: 'สาขานี้มีการตั้งค่าที่เริ่มเดือนนี้อยู่แล้ว — ลบอันเดิมก่อน',
  'not-found': 'ไม่พบการตั้งค่านี้',
  busy: 'มีแอดมินอีกคนกำลังคำนวณหรือเผยแพร่เงินเดือนอยู่ กรุณาลองใหม่อีกครั้ง',
};

function branchCutoffError(r: { reason: string; frozenMonth?: string }): string {
  if (r.reason === 'frozen') {
    return `เปลี่ยนไม่ได้ — สาขานี้เผยแพร่สลิปเดือน ${r.frozenMonth} แล้ว ซึ่งอยู่ในช่วงที่จะได้รับผล (เลือกเดือนที่เริ่มหลังจากนั้น)`;
  }
  return BRANCH_CUTOFF_ERRORS[r.reason] ?? 'ข้อมูลไม่ถูกต้อง';
}

export async function addBranchCutoffAction(formData: FormData) {
  const { user } = await requirePermission('settings.attendance.manage');
  const parsed = BranchCutoffSchema.safeParse({
    branchId: formData.get('branchId'),
    fromMonth: formData.get('fromMonth'),
    cutoffDay: formData.get('branchCutoffDay'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/attendance?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }
  const r = await addBranchCutoff({ ...parsed.data, actorId: user.id });
  if (!r.ok)
    redirect(`/admin/settings/attendance?error=${encodeURIComponent(branchCutoffError(r))}`);
  revalidatePath('/admin/settings/attendance');
  redirect('/admin/settings/attendance?ok=1');
}

export async function removeBranchCutoffAction(id: string) {
  const { user } = await requirePermission('settings.attendance.manage');
  const r = await removeBranchCutoff({ id, actorId: user.id });
  if (!r.ok)
    redirect(`/admin/settings/attendance?error=${encodeURIComponent(branchCutoffError(r))}`);
  revalidatePath('/admin/settings/attendance');
  redirect('/admin/settings/attendance?ok=1');
}
