'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import type { ActionResult } from '@/components/ui/confirm-dialog';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import {
  lockPayroll,
  notifyPublishedSlips,
  type PayrollRowDetail,
  type PublishResult,
  payrollRowDetail,
  publishPayroll,
  runPayrollDraft,
} from '@/lib/payroll/run';
import { warmPublishedPayslips } from '@/lib/payslip/warm';
import { readForm } from './adjustments/adjustment-schema';

/**
 * Schedule background pre-rendering of freshly-published slips so each
 * employee's first LIFF open is instant. Runs after the response via `after()`,
 * so it never delays the publish action. Best-effort — failures are swallowed
 * inside warmPublishedPayslips and the slip just renders lazily on first open.
 */
async function scheduleSlipWarming(month: string, slips: { employeeId: string }[]): Promise<void> {
  if (slips.length === 0) return;
  // The employee's preferred locale lives on the linked User (see schema).
  const employees = await prisma.employee.findMany({
    where: { id: { in: slips.map((s) => s.employeeId) } },
    select: { id: true, user: { select: { locale: true } } },
  });
  const localeById = new Map(employees.map((e) => [e.id, e.user.locale]));
  const targets = slips.map((s) => ({
    employeeId: s.employeeId,
    locale: localeById.get(s.employeeId) ?? null,
  }));
  after(() => warmPublishedPayslips({ month, targets }));
}

/**
 * Monthly payroll run actions — thin permission/audit wrappers around
 * the pipeline in src/lib/payroll/run.ts.
 *
 * Permission split per the original phase plan:
 *   - payroll.run     → calculate (draft)
 *   - payroll.publish → publish + lock
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Current YYYY-MM in Bangkok. */
function currentMonthBkk(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date());
}

export async function publishPayrollAction(formData: FormData) {
  const { user } = await requirePermission('payroll.publish');
  const month = readMonth(formData);

  // Publishing fires LINE pushes and stamps sweep rows — block future
  // months so a mis-clicked navigator can't blast notifications early.
  if (month > currentMonthBkk()) {
    back(month, 'ยังเผยแพร่เดือนล่วงหน้าไม่ได้ — เผยแพร่ได้ไม่เกินเดือนปัจจุบัน');
  }

  const result = await publishPayroll(month);
  await notifyPublishedSlips(month, result.published);
  await scheduleSlipWarming(month, result.published);

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

/**
 * Quick-add adjustment from the run-table row modal. Same validation as
 * the registry form (employeeId/month arrive as hidden fields), then
 * auto-recalculates the month's Drafts so the table reflects the change
 * without a manual "คำนวณใหม่" — Published/Locked rows stay untouched
 * (runPayrollDraft never overwrites them).
 */
export async function createRowAdjustment(formData: FormData) {
  const { user } = await requirePermission('payroll.run');
  const month = readMonth(formData);

  const parsed = readForm(formData);
  if (!parsed.success) {
    back(month, `เพิ่มรายการไม่สำเร็จ: ${parsed.error}`);
  }
  const data = parsed.data;

  const created = await prisma.payrollAdjustment.create({
    data: {
      employeeId: data.employeeId,
      kind: data.kind,
      reason: data.reason,
      amount: new Prisma.Decimal(data.amount),
      startMonth: data.startMonth,
      endMonth: data.endMonth,
      note: data.note,
    },
  });
  auditLog({
    actorId: user.id,
    action: 'payrollAdjustment.create',
    entityType: 'PayrollAdjustment',
    entityId: created.id,
    after: { ...data },
    metadata: { source: 'admin-ui', via: 'payroll-row-modal' },
  });

  await runPayrollDraft(month);
  revalidatePath('/admin/payroll/adjustments');
  back(month, `เพิ่ม${data.kind === 'Income' ? 'เงินเพิ่ม' : 'เงินลด'} "${data.reason}" และคำนวณใหม่แล้ว`);
}

/**
 * Soft-delete from the row modal's ConfirmDialog, then auto-recalc the
 * month's Drafts. Returns an ActionResult (no redirect) — ConfirmDialog
 * shows `message` inline on failure and router.refresh()es on success.
 */
export async function deleteRowAdjustment(
  id: string,
  month: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { user } = await requirePermission('payroll.run');
  if (!MONTH_RE.test(month)) return { ok: false, message: 'เดือนไม่ถูกต้อง' };

  const before = await prisma.payrollAdjustment.findUnique({ where: { id } });
  if (!before || before.deletedAt) return { ok: false, message: 'ไม่พบรายการ' };

  await prisma.payrollAdjustment.update({ where: { id }, data: { deletedAt: new Date() } });
  auditLog({
    actorId: user.id,
    action: 'payrollAdjustment.delete',
    entityType: 'PayrollAdjustment',
    entityId: id,
    before: {
      employeeId: before.employeeId,
      kind: before.kind,
      reason: before.reason,
      amount: before.amount.toString(),
      startMonth: before.startMonth,
      endMonth: before.endMonth,
    },
    metadata: { source: 'admin-ui', via: 'payroll-row-modal' },
  });

  await runPayrollDraft(month);
  revalidatePath('/admin/payroll');
  revalidatePath('/admin/payroll/adjustments');
  return { ok: true };
}

/**
 * Lazy-load a single employee's payslip detail on modal open.
 * Gated by payroll.read — same as the page itself.
 */
export async function loadPayrollRowDetailAction(
  employeeId: string,
  month: string,
): Promise<PayrollRowDetail | null> {
  await requirePermission('payroll.read');
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) return null;
  return payrollRowDetail(month, employeeId);
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

/**
 * Per-employee publish — driven by the row-level ConfirmDialog.
 * Returns ActionResult (no redirect) so the dialog can show inline
 * success/failure without a full-page navigation.
 */
export async function publishOnePayrollAction(
  employeeId: string,
  month: string,
): Promise<ActionResult> {
  const { user } = await requirePermission('payroll.publish');
  if (!MONTH_RE.test(month)) return { ok: false, message: 'เดือนไม่ถูกต้อง' };
  if (!UUID_RE.test(employeeId)) return { ok: false, message: 'พนักงานไม่ถูกต้อง' };
  if (month > currentMonthBkk()) {
    return { ok: false, message: 'ยังเผยแพร่เดือนล่วงหน้าไม่ได้ — เผยแพร่ได้ไม่เกินเดือนปัจจุบัน' };
  }

  let result: PublishResult;
  try {
    result = await publishPayroll(month, { employeeId });
  } catch (err) {
    console.error('publishOnePayrollAction: publish failed', err);
    return { ok: false, message: 'เกิดข้อผิดพลาดในการเผยแพร่ กรุณาลองใหม่' };
  }
  if (result.published.length === 0) {
    return { ok: false, message: 'ไม่มีสลิปฉบับร่างให้เผยแพร่ (อาจเผยแพร่ไปแล้ว)' };
  }

  // Publish already committed — a LINE failure must never undo it or skip the audit.
  try {
    await notifyPublishedSlips(month, result.published);
  } catch (err) {
    console.error('publishOnePayrollAction: LINE notify failed (publish already committed)', err);
  }
  await scheduleSlipWarming(month, result.published);

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    entityId: month,
    metadata: {
      source: 'admin-ui',
      via: 'per-employee',
      employeeId,
      published: result.published.length,
    },
  });

  revalidatePath('/admin/payroll');
  return { ok: true };
}
