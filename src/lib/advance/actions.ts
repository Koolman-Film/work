'use server';

/**
 * Cash-advance Server Actions for the LIFF flow.
 *
 * Shape differs from leave in two notable ways:
 *   - No reason / note field on CashAdvance — the admin's review artifact
 *     is the receipt image (admin.ts handles approve/reject). Employee
 *     intent only captures amount + timestamp.
 *   - No date range — an advance is a one-shot loan against future
 *     payroll, not a multi-day affair.
 *
 * Why we use Prisma.Decimal directly instead of `number`:
 *   - JavaScript numbers can't represent every two-decimal money value
 *     exactly (0.1 + 0.2 ≠ 0.3). For ฿ amounts up to 1M, IEEE-754 is
 *     "close enough" — but payroll math (Phase 2) sums these and we want
 *     zero accumulated drift. Storing as Decimal forces honest arithmetic
 *     from the moment the value enters the system.
 */

import { type Employee, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';

/** Same display-name policy as leave/actions.ts — prefer nickname, fall
 *  back to full name. Kept as a per-file helper rather than a shared util
 *  because the rule is short and exporting from leave/actions would force
 *  unrelated re-imports. */
function employeeDisplayName(e: Pick<Employee, 'firstName' | 'lastName' | 'nickname'>): string {
  if (e.nickname && e.nickname.trim().length > 0) return e.nickname;
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Format a baht amount with thousands separators + 2 decimal places for
 *  the admin bell payload. Mirrors the formatter in advance/admin.ts. */
function formatBaht(amount: number): string {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type SubmitAdvanceResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: 'forbidden' | 'bad-amount' | 'too-large' | 'pending-exists' | 'db-error';
      message: string;
    };

export type CancelAdvanceResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'not-found' | 'not-cancellable'; message: string };

/** Cap a single request — sanity bound, real cap is at admin's discretion. */
const MAX_AMOUNT = 100_000; // ฿100,000

type SubmitInput = { amount: number };

export async function submitCashAdvance(input: SubmitInput): Promise<SubmitAdvanceResult> {
  const { user, employee } = await requireRole(['Staff']);
  // Worker-facing strings localized to the requester's locale (NEXT_LOCALE
  // cookie); `code` stays the stable machine-readable discriminant.
  const t = await getTranslations('advance');
  if (!employee) {
    return { ok: false, code: 'forbidden', message: t('errors.noEmployee') };
  }
  if (employee.archivedAt || employee.status === 'Archived') {
    return { ok: false, code: 'forbidden', message: t('errors.employeeArchived') };
  }

  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    // Reject more than 2 decimal places — protects against sneaky 0.001
    // edge cases sneaking in via locale-specific parsing.
    Math.round(input.amount * 100) !== input.amount * 100
  ) {
    return {
      ok: false,
      code: 'bad-amount',
      message: t('errors.badAmount'),
    };
  }
  if (input.amount > MAX_AMOUNT) {
    return {
      ok: false,
      code: 'too-large',
      message: t('errors.tooLarge', { max: MAX_AMOUNT }),
    };
  }

  // Refuse if there's already a pending request — only one in flight at a
  // time to keep the admin inbox uncluttered + force the employee to make
  // a single best-effort estimate per pay period.
  const pending = await prisma.cashAdvance.findFirst({
    where: { employeeId: employee.id, status: 'Pending' },
    select: { id: true },
  });
  if (pending) {
    return {
      ok: false,
      code: 'pending-exists',
      message: t('errors.pendingExists'),
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const created = await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(input.amount),
        status: 'Pending',
      },
      select: { id: true },
    });

    auditLog({
      actorId: user.id,
      action: 'advance.submit',
      entityType: 'CashAdvance',
      entityId: created.id,
      after: { amount: input.amount.toString() },
      metadata: { ip, userAgent, source: 'liff' },
    });

    // Fan-out in-app bell (fire-and-forget — see leave/actions.ts).
    void notifyAdminsInApp({
      kind: 'advance.submitted',
      cashAdvanceId: created.id,
      employeeName: employeeDisplayName(employee),
      amount: formatBaht(input.amount),
    });

    revalidatePath('/liff/advance');
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[submitCashAdvance] failed', err);
    return { ok: false, code: 'db-error', message: t('errors.dbError') };
  }
}

export async function cancelCashAdvance(id: string): Promise<CancelAdvanceResult> {
  const { user, employee } = await requireRole(['Staff']);
  const t = await getTranslations('advance');
  if (!employee) {
    return { ok: false, code: 'forbidden', message: t('errors.noEmployee') };
  }

  const row = await prisma.cashAdvance.findUnique({
    where: { id },
    select: { id: true, employeeId: true, status: true },
  });
  if (!row) {
    return { ok: false, code: 'not-found', message: t('errors.notFound') };
  }
  if (row.employeeId !== employee.id) {
    return { ok: false, code: 'forbidden', message: t('errors.notOwner') };
  }
  if (row.status !== 'Pending') {
    return {
      ok: false,
      code: 'not-cancellable',
      message: t('errors.notCancellable'),
    };
  }

  try {
    await prisma.cashAdvance.update({
      where: { id: row.id },
      data: { status: 'Cancelled' },
    });
    auditLog({
      actorId: user.id,
      action: 'advance.cancel',
      entityType: 'CashAdvance',
      entityId: row.id,
      before: { status: 'Pending' },
      after: { status: 'Cancelled' },
      metadata: { source: 'liff' },
    });
    revalidatePath('/liff/advance');
    return { ok: true };
  } catch (err) {
    console.error('[cancelCashAdvance] failed', err);
    return { ok: false, code: 'forbidden', message: t('errors.dbError') };
  }
}
