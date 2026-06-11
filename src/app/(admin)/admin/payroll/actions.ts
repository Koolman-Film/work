'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import {
  lockPayroll,
  notifyPublishedSlips,
  publishPayroll,
  runPayrollDraft,
} from '@/lib/payroll/run';

/**
 * Monthly payroll run actions — thin permission/audit wrappers around
 * the pipeline in src/lib/payroll/run.ts.
 *
 * Permission split per the original phase plan:
 *   - payroll.run     → calculate (draft)
 *   - payroll.publish → publish + lock
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function readMonth(formData: FormData): string {
  const month = String(formData.get('month') ?? '');
  if (!MONTH_RE.test(month)) redirect('/admin/payroll');
  return month;
}

function back(month: string, msg: string): never {
  revalidatePath('/admin/payroll');
  redirect(`/admin/payroll?m=${month}&msg=${encodeURIComponent(msg)}`);
}

export async function calculatePayrollAction(formData: FormData) {
  const { user } = await requirePermission('payroll.run');
  const month = readMonth(formData);

  const result = await runPayrollDraft(month);

  auditLog({
    actorId: user.id,
    action: 'payroll.run',
    entityType: 'Payroll',
    entityId: month,
    metadata: {
      source: 'admin-ui',
      calculated: result.calculated,
      frozen: result.frozen,
      skipped: result.skipped,
    },
  });

  const parts = [`คำนวณแล้ว ${result.calculated} คน`];
  if (result.frozen > 0) parts.push(`ข้าม ${result.frozen} คนที่เผยแพร่แล้ว`);
  if (result.skipped.length > 0)
    parts.push(`ข้าม ${result.skipped.length} คน (ประเภทเงินเดือนยังไม่รองรับ)`);
  back(month, parts.join(' · '));
}

export async function publishPayrollAction(formData: FormData) {
  const { user } = await requirePermission('payroll.publish');
  const month = readMonth(formData);

  const result = await publishPayroll(month);
  await notifyPublishedSlips(month, result.published);

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    entityId: month,
    metadata: {
      source: 'admin-ui',
      published: result.published.length,
      skipped: result.skipped,
    },
  });

  back(month, `เผยแพร่สลิป ${result.published.length} คน และส่งแจ้งเตือน LINE แล้ว`);
}

export async function lockPayrollAction(formData: FormData) {
  const { user } = await requirePermission('payroll.publish');
  const month = readMonth(formData);

  const count = await lockPayroll(month);

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    entityId: month,
    metadata: { source: 'admin-ui', phase: 'lock', locked: count },
  });

  back(month, `ล็อกสลิป ${count} คน`);
}
