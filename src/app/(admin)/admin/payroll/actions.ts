'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import type { ActionResult } from '@/components/ui/confirm-dialog';
import { auditLog, auditLogMany } from '@/lib/audit/log';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import {
  lockPayroll,
  type PayrollRowDetail,
  type PublishResult,
  payrollRowDetail,
  publishPayroll,
  type RunResult,
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

/**
 * Redirect back to the payroll page carrying a status message.
 *
 * `severity` decides which visual treatment page.tsx renders the message
 * with: 'success' (default) is the green banner used for a clean, complete
 * result; 'alert' reuses the SAME amber/`role="alert"` treatment the page
 * already renders for its stale-draft warning — for a partial result (some
 * employees held back) or an outright failure, where the green treatment
 * would read as "everything is fine" to a skimming admin when it isn't.
 */
function back(month: string, msg: string, severity: 'success' | 'alert' = 'success'): never {
  revalidatePath('/admin/payroll');
  const sevQs = severity === 'alert' ? '&sev=alert' : '';
  redirect(`/admin/payroll?m=${month}&msg=${encodeURIComponent(msg)}${sevQs}`);
}

export async function calculatePayrollAction(formData: FormData) {
  const { user } = await requireGlobalPermission('payroll.run');
  const month = readMonth(formData);

  let result: RunResult;
  try {
    result = await runPayrollDraft(month);
  } catch (err) {
    // Unhandled, this rejects the server action and surfaces as a generic
    // error boundary instead of an actionable message — the same gap
    // publishOnePayrollAction below already closes for its own publish call.
    // Most likely cause now that runPayrollDraft holds the month's advisory
    // lock across a full recompute: a concurrent settle/publish/recalculate
    // for the same month held the lock long enough to exhaust this
    // transaction's `timeout` (see run.ts's "Transaction timeout" note).
    console.error('calculatePayrollAction: run failed', err);
    back(month, 'คำนวณเงินเดือนไม่สำเร็จ ระบบอาจกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง', 'alert');
  }

  // Defect 1: the month's advisory lock (month-lock.ts) is now acquired
  // non-blocking, so a concurrent settle/publish/recalculate on this same
  // month returns a clean `busy` result instead of this call queueing for
  // up to its whole `timeout` and possibly still throwing P2028. Surfaced
  // as an actionable Thai message rather than falling through to the audit
  // log below with all-zero counts.
  if (result.busy) {
    back(month, 'มีแอดมินอีกคนกำลังคำนวณหรือเผยแพร่เงินเดือนเดือนนี้อยู่ กรุณาลองใหม่อีกครั้ง', 'alert');
  }

  // One row per Payroll actually recalculated. A month-wide action has no
  // single entity to point at, and `entityId` is @db.Uuid — passing `month`
  // here made Postgres reject every one of these writes, silently, because
  // auditLog swallows its own errors.
  auditLogMany(
    result.calculatedPayrollIds.map((payrollId) => ({
      actorId: user.id,
      action: 'payroll.run' as const,
      entityType: 'Payroll',
      entityId: payrollId,
      metadata: {
        source: 'admin-ui',
        month,
        calculated: result.calculated,
        frozen: result.frozen,
        skipped: result.skipped,
      },
    })),
  );

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
  const { user } = await requireGlobalPermission('payroll.publish');
  const month = readMonth(formData);

  // Publishing stamps sweep rows early — block future months so a
  // mis-clicked navigator can't lock those in ahead of time.
  if (month > currentMonthBkk()) {
    back(month, 'ยังเผยแพร่เดือนล่วงหน้าไม่ได้ — เผยแพร่ได้ไม่เกินเดือนปัจจุบัน', 'alert');
  }

  let result: PublishResult;
  try {
    result = await publishPayroll(month);
  } catch (err) {
    // Unhandled, this rejects the server action and surfaces as a generic
    // error boundary — the gap Defect 1 closes. publishPayroll now has its
    // own explicit transaction budget at least as large as
    // runPayrollDraft's (see run.ts), so this is no longer the routine "lost
    // the budget race against a concurrent คำนวณ" case it used to be, but a
    // transaction can still fail (contention, a genuine DB hiccup) and must
    // not crash the action — mirrors publishOnePayrollAction below.
    console.error('publishPayrollAction: publish failed', err);
    back(month, 'เผยแพร่สลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'alert');
  }

  // Defect 1: same non-blocking-lock `busy` outcome as calculatePayrollAction
  // above — another admin's settle/publish/recalculate holds this month's
  // lock right now. Nothing was published, so bail before the audit log and
  // slip-warming below (both would otherwise report a no-op as a success).
  if (result.busy) {
    back(month, 'มีแอดมินอีกคนกำลังคำนวณหรือเผยแพร่เงินเดือนเดือนนี้อยู่ กรุณาลองใหม่อีกครั้ง', 'alert');
  }

  // No automatic per-employee LINE push here anymore — employees read
  // their slip from the LINE rich menu instead (quota reduction).
  await scheduleSlipWarming(month, result.published);

  // One row per slip published. PublishedSlip already carries the real
  // Payroll UUID, so the trail says whose pay was published rather than only
  // that a month was — and `entityId` is @db.Uuid, which the month string
  // this used to pass could never satisfy.
  auditLogMany(
    result.published.map((slip) => ({
      actorId: user.id,
      action: 'payroll.publish' as const,
      entityType: 'Payroll',
      entityId: slip.payrollId,
      metadata: {
        source: 'admin-ui',
        month,
        employeeId: slip.employeeId,
        published: result.published.length,
        skipped: result.skipped,
        blocked: result.blocked,
      },
    })),
  );

  // Defect-3 guard (run.ts): each named employee below carries a live
  // settlement that outlived the penalty that justified it (a late-penalty
  // rule toggled off, a voided attendance row, a corrected absence).
  // Publishing them would freeze that settlement uneditable forever, so
  // THOSE employees were held back — everyone else above published
  // normally (this is a per-employee skip, not a whole-month hard stop; see
  // `blocked` on `PublishResult`). The named employees stay in Draft: clear
  // or adjust the settlement on the reconcile page, then publish again
  // (the whole month, or just that row) to pick them up.
  if (result.blocked.length > 0) {
    const names = [...new Set(result.blocked.map((b) => b.name))].join(', ');
    back(
      month,
      `เผยแพร่สลิป ${result.published.length} คนแล้ว — ยกเว้น ${names} ที่มีการหักสิทธิวันลาเกินโทษจริง ไปแก้ไขหรือยกเลิกการหักสิทธิที่หน้ากระทบยอดก่อน แล้วเผยแพร่ใหม่อีกครั้ง`,
      'alert',
    );
  }

  back(month, `เผยแพร่สลิป ${result.published.length} คนแล้ว`);
}

/**
 * Quick-add adjustment from the run-table row modal. Same validation as
 * the registry form (employeeId/month arrive as hidden fields), then
 * auto-recalculates the month's Drafts so the table reflects the change
 * without a manual "คำนวณใหม่" — Published/Locked rows stay untouched
 * (runPayrollDraft never overwrites them).
 */
export async function createRowAdjustment(formData: FormData) {
  const { user } = await requireGlobalPermission('payroll.run');
  // The row modal sends `month` as a hidden field (recompute + redirect target).
  // Fall back to `startMonth` — always the row's month here — so a form that
  // omits `month` still saves + recomputes instead of silently redirecting out
  // (the bug that made the per-row +เพิ่ม/ลด button appear to do nothing).
  const month = String(formData.get('month') || formData.get('startMonth') || '');
  if (!MONTH_RE.test(month)) redirect('/admin/payroll');

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

  // Defect 3: the adjustment above is already committed — a throw (or a
  // `busy` lock-contention result) from the recalculation below must NEVER
  // reject this action. `payrollAdjustment` has no idempotency key, so an
  // admin who sees an error screen after the write already succeeded will
  // resubmit the same form and create a SECOND adjustment for the same
  // reason/amount — a real double-charge, not just a confusing message.
  // Mirrors `recalculateAfterSettlement` (reconcile/actions.ts), which the
  // wave that added it explicitly cited this function as the precedent for.
  let recalcPending = false;
  try {
    const result = await runPayrollDraft(month);
    if (result.busy) recalcPending = true; // lock contended — not an error
  } catch (err) {
    console.error(
      'createRowAdjustment: runPayrollDraft failed after adjustment already committed',
      err,
    );
    recalcPending = true;
  }

  revalidatePath('/admin/payroll/adjustments');
  const label = `${data.kind === 'Income' ? 'เงินเพิ่ม' : 'เงินลด'} "${data.reason}"`;
  if (recalcPending) {
    back(
      month,
      `บันทึก${label}เรียบร้อยแล้ว แต่คำนวณฉบับร่างใหม่ไม่สำเร็จ — ไปกด "คำนวณ" อีกครั้งที่หน้าเงินเดือน`,
      'alert',
    );
  }
  back(month, `เพิ่ม${label}และคำนวณใหม่แล้ว`);
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
  const { user } = await requireGlobalPermission('payroll.run');
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

  // Defect 3 (same shape as createRowAdjustment above): the soft-delete
  // already committed — a throw here is not corrupting (a retry finds the
  // row already gone), but it MUST NOT make this function report a
  // completed delete as a failure. ConfirmDialog (confirm-dialog.tsx) has
  // no try/catch around `await action(...)`, so an uncaught rejection here
  // would surface as a crashed transition instead of the clean `{ok:true}`
  // this delete actually earned. The Draft numbers simply stay stale until
  // the admin next presses "คำนวณ" — same fallback `recalcPending` accepts
  // elsewhere; there is no field on `ActionResult` to surface a pending
  // note through, so this only logs server-side.
  try {
    const result = await runPayrollDraft(month);
    if (result.busy) {
      console.warn('deleteRowAdjustment: runPayrollDraft busy after delete already committed', {
        month,
      });
    }
  } catch (err) {
    console.error(
      'deleteRowAdjustment: runPayrollDraft failed after delete already committed',
      err,
    );
  }

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
  await requireGlobalPermission('payroll.read');
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) return null;
  return payrollRowDetail(month, employeeId);
}

/**
 * Resend the LINE rich message for an already-published slip — the safety net
 * when the original push failed. Re-queues with a fresh dedupeSuffix so the
 * 24h Inngest dedup window doesn't silently swallow it. Confirms only that the
 * push was QUEUED (delivery is async with retries), so the UI says "may take a
 * moment", not "delivered".
 */
export async function resendPayslipNotificationAction(
  employeeId: string,
  month: string,
): Promise<ActionResult> {
  const { user } = await requireGlobalPermission('payroll.publish');
  if (!MONTH_RE.test(month)) return { ok: false, message: 'เดือนไม่ถูกต้อง' };
  if (!UUID_RE.test(employeeId)) return { ok: false, message: 'พนักงานไม่ถูกต้อง' };

  const payroll = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { in: ['Published', 'Locked'] } },
    select: {
      id: true,
      netPay: true,
      employee: {
        select: { firstName: true, userId: true, user: { select: { lineUserId: true } } },
      },
    },
  });
  if (!payroll) return { ok: false, message: 'ยังไม่ได้เผยแพร่สลิปงวดนี้' };
  if (!payroll.employee.user?.lineUserId) {
    return { ok: false, message: 'พนักงานยังไม่ได้เชื่อมบัญชี LINE — ส่งสลิปไม่ได้' };
  }

  try {
    await sendNotification(
      payroll.employee.userId,
      {
        kind: 'payroll.published',
        payrollId: payroll.id,
        month,
        employeeFirstName: payroll.employee.firstName,
        // Same formatting publishPayroll uses for the original push.
        netPay: payroll.netPay.toNumber().toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
      // Fresh per call → bypasses the 24h dedup window. Server-action runtime,
      // so Date.now()/randomness are fine here (this is not a workflow script).
      { dedupeSuffix: `resend-${Date.now().toString(36)}` },
    );
  } catch (err) {
    console.error('resendPayslipNotificationAction: LINE notify failed', err);
    return { ok: false, message: 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่' };
  }

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    // The Payroll row itself, which this action already had in hand — it was
    // sitting in metadata while `month` went into the @db.Uuid column.
    entityId: payroll.id,
    metadata: { source: 'admin-ui', via: 'resend', month, employeeId },
  });

  return { ok: true };
}

export async function lockPayrollAction(formData: FormData) {
  const { user } = await requireGlobalPermission('payroll.publish');
  const month = readMonth(formData);

  const lockedIds = await lockPayroll(month);

  auditLogMany(
    lockedIds.map((payrollId) => ({
      actorId: user.id,
      action: 'payroll.publish' as const,
      entityType: 'Payroll',
      entityId: payrollId,
      metadata: { source: 'admin-ui', phase: 'lock', month, locked: lockedIds.length },
    })),
  );

  back(month, `ล็อกสลิป ${lockedIds.length} คน`);
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
  const { user } = await requireGlobalPermission('payroll.publish');
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

  // Defect 1: the month's lock (month-lock.ts) is held by another admin's
  // settle/publish/recalculate right now. Checked BEFORE the "nothing to
  // publish" branch below — a `busy` result also has an empty `published`,
  // and would otherwise be misreported as "already published" instead of
  // "try again".
  if (result.busy) {
    return { ok: false, message: 'มีแอดมินอีกคนกำลังคำนวณหรือเผยแพร่เงินเดือนเดือนนี้อยู่ กรุณาลองใหม่อีกครั้ง' };
  }

  // Defect-3 guard (run.ts): this call's scope is the ONE target employee —
  // there is no "everyone else" for it to publish instead, so a non-empty
  // `blocked` here means THIS employee's live settlement outlived the
  // penalty that justified it, and refusing them is the whole outcome of
  // this call (contrast publishPayrollAction above, which still publishes
  // every other employee in the month around a blocked one).
  if (result.blocked.length > 0) {
    return {
      ok: false,
      message:
        'เผยแพร่ไม่สำเร็จ: พนักงานคนนี้มีการหักสิทธิวันลาเกินโทษจริงของเดือนนี้ — ไปแก้ไขหรือยกเลิกการหักสิทธิที่หน้ากระทบยอดก่อนเผยแพร่',
    };
  }
  if (result.published.length === 0) {
    return { ok: false, message: 'ไม่มีสลิปฉบับร่างให้เผยแพร่ (อาจเผยแพร่ไปแล้ว)' };
  }

  // No automatic per-employee LINE push here anymore — employees read
  // their slip from the LINE rich menu instead (quota reduction).
  await scheduleSlipWarming(month, result.published);

  // Normally exactly one slip, but publishPayroll returns a list either way —
  // map it rather than assuming, so a future multi-row call still audits
  // every row it wrote.
  auditLogMany(
    result.published.map((slip) => ({
      actorId: user.id,
      action: 'payroll.publish' as const,
      entityType: 'Payroll',
      entityId: slip.payrollId,
      metadata: {
        source: 'admin-ui',
        via: 'per-employee',
        month,
        employeeId,
        published: result.published.length,
      },
    })),
  );

  revalidatePath('/admin/payroll');
  return { ok: true };
}
