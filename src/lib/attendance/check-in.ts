'use server';

/**
 * `submitCheckIn` / `submitCheckOut` / `getCheckInState` — Server Actions
 * for the LIFF check-in widget.
 *
 * Responsibilities (per docs/v2/build-plan.md §W3):
 *   - Authenticate via Supabase session (no LIFF-token re-verify needed;
 *     the proxy guarantees a session exists for /liff/check-in callers).
 *   - Reject archived or check-in-disabled employees.
 *   - Run the pure `evaluateCheckIn` to decide Confirmed / Disputed.
 *   - Idempotency: refuse a second `CheckIn` of type=CheckIn for the same
 *     employee on the same date.
 *   - Write the Attendance row + audit log inside one transaction.
 *
 * Deferred to W3c:
 *   - Selfie upload (Branch.requireSelfie path).
 *   - Inngest `attendance.recorded` emission for downstream late-check.
 *   - Force-checkout cron.
 */

import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { type CheckInPoint, disputeReasonText, evaluateCheckIn } from './evaluate';

export type CheckInState = {
  /** YYYY-MM-DD in the server's timezone (Asia/Bangkok). */
  today: string;
  /** True if Employee has any `type=CheckIn` row for today. */
  hasCheckedIn: boolean;
  /** True if Employee has set `clockOutAt` on today's row. */
  hasCheckedOut: boolean;
  /** ISO timestamp of today's check-in, if any. */
  clockInAt: string | null;
  /** Status the system assigned to the check-in (Confirmed/Disputed). */
  checkInStatus: 'Confirmed' | 'Disputed' | 'Rejected' | null;
  /** Branch name (for the "เช็คอินที่สาขา X" line). */
  branchName: string | null;
};

export type SubmitCheckInResult =
  | { ok: true; state: CheckInState; outcome: 'Confirmed' | 'Disputed'; message: string }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'already-checked-in'
        | 'already-checked-out'
        | 'not-checked-in'
        | 'db-error';
      message: string;
    };

/** Compute YYYY-MM-DD in Asia/Bangkok regardless of server timezone. */
function bangkokDateString(d: Date): string {
  // Intl handles the timezone conversion robustly without pulling in date-fns-tz
  // for this single use. The locale produces YYYY-MM-DD when given 'sv-SE'.
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

/** Helper: today's start-of-day in UTC for Prisma's `@db.Date` column. */
function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = bangkokDateString(d);
  // Prisma @db.Date stores at UTC midnight. We need the *date* part — not
  // the local-midnight instant. So construct from the YYYY-MM-DD string.
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Fetch the employee's assigned branches with geofence data. */
async function loadCandidateBranches(employeeId: string) {
  // The employee row holds `branchId` (home) and `assignedBranchIds[]`
  // (additional). Merge into a unique set, then fetch in one query.
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp) return [];

  const ids = Array.from(new Set([emp.branchId, ...emp.assignedBranchIds]));
  const branches = await prisma.branch.findMany({
    where: { id: { in: ids }, archivedAt: null },
    select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true },
  });

  return branches.map((b) => ({
    id: b.id,
    name: b.name,
    // Prisma Decimal → number for our pure math layer.
    latitude: b.latitude ? Number(b.latitude) : null,
    longitude: b.longitude ? Number(b.longitude) : null,
    radiusMeters: b.radiusMeters,
  }));
}

/** Read-only — fetches today's attendance row (if any) to drive the UI button state. */
export async function getCheckInState(): Promise<CheckInState> {
  const { employee } = await requireRole(['Employee']);
  if (!employee) {
    // requireRole would have notFound()'d already; this is just for type narrowing.
    throw new Error('requireRole returned no employee');
  }

  const today = bangkokDateUtcMidnight(new Date());

  // The day's CheckIn row (we only ever insert one of type=CheckIn per day).
  const row = await prisma.attendance.findFirst({
    where: { employeeId: employee.id, date: today, type: 'CheckIn' },
    include: { checkInBranch: { select: { name: true } } },
  });

  return {
    today: bangkokDateString(new Date()),
    hasCheckedIn: !!row,
    hasCheckedOut: !!row?.clockOutAt,
    clockInAt: row?.clockInAt ? row.clockInAt.toISOString() : null,
    checkInStatus: row?.checkInStatus ?? null,
    branchName: row?.checkInBranch?.name ?? null,
  };
}

export async function submitCheckIn(input: CheckInPoint): Promise<SubmitCheckInResult> {
  const { user, employee } = await requireRole(['Employee']);
  if (!employee) {
    return { ok: false, code: 'forbidden', message: 'ไม่พบบัญชีพนักงาน' };
  }

  // Defensive — requireRole archived-check is for User, not Employee.
  if (employee.archivedAt || employee.status === 'Archived' || !employee.canCheckIn) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'บัญชีนี้ถูกระงับการเช็คอิน — ติดต่อแอดมิน',
    };
  }

  const now = new Date();
  const today = bangkokDateUtcMidnight(now);

  // Load candidate branches + the previous check-in fix (for impossible-travel).
  const [candidateBranches, existing] = await Promise.all([
    loadCandidateBranches(employee.id),
    prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: today, type: 'CheckIn' },
      select: { id: true, clockInAt: true, clockOutAt: true },
    }),
  ]);

  if (existing) {
    return {
      ok: false,
      code: 'already-checked-in',
      message: 'คุณเช็คอินวันนี้แล้ว',
    };
  }

  // Pure decision — Confirmed vs Disputed.
  const verdict = evaluateCheckIn({
    point: input,
    candidateBranches,
    previousCheckInAt: null, // first check-in of the day
    now,
  });

  const disputeReason = verdict.status === 'Disputed' ? disputeReasonText(verdict.reason) : null;

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.attendance.create({
        data: {
          employeeId: employee.id,
          date: today,
          type: 'CheckIn',
          source: 'Liff',
          clockInAt: now,
          checkInLat: new Prisma.Decimal(input.lat),
          checkInLng: new Prisma.Decimal(input.lng),
          checkInBranchId: verdict.branchId,
          checkInStatus: verdict.status,
          disputeReason,
          // For LIFF check-ins the actor IS the employee — their User row's id.
          // Admin manual entries and cron rows fill this with a different actor.
          createdById: user.id,
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.checkin',
        entityType: 'Attendance',
        entityId: created.id,
        after: {
          status: verdict.status,
          branchId: verdict.branchId,
          distanceMeters:
            verdict.status === 'Confirmed' || verdict.status === 'Disputed'
              ? verdict.distanceMeters
              : null,
          accuracy: input.accuracy,
        },
        metadata: { ip, userAgent, source: 'liff' },
      });
    });
  } catch (err) {
    console.error('[submitCheckIn] tx failed', err);
    return {
      ok: false,
      code: 'db-error',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }

  const state = await getCheckInState();
  const message =
    verdict.status === 'Confirmed'
      ? `เช็คอินสำเร็จ${verdict.branchName ? ` ที่${verdict.branchName}` : ''}`
      : `เช็คอินบันทึกแล้ว แต่ต้องตรวจสอบ: ${disputeReason ?? 'unknown'}`;

  return { ok: true, state, outcome: verdict.status, message };
}

export async function submitCheckOut(): Promise<SubmitCheckInResult> {
  // For now check-out is a simple "set clockOutAt on today's row" — no
  // geofence re-check on the out side. v2 build-plan keeps it minimal in
  // W3b; W3c can layer geofence-out if we decide it's needed.
  const { user, employee } = await requireRole(['Employee']);
  if (!employee) {
    return { ok: false, code: 'forbidden', message: 'ไม่พบบัญชีพนักงาน' };
  }
  if (employee.archivedAt || employee.status === 'Archived') {
    return { ok: false, code: 'forbidden', message: 'บัญชีนี้พ้นสภาพแล้ว' };
  }

  const now = new Date();
  const today = bangkokDateUtcMidnight(now);

  const row = await prisma.attendance.findFirst({
    where: { employeeId: employee.id, date: today, type: 'CheckIn' },
    select: { id: true, clockOutAt: true },
  });

  if (!row) {
    return { ok: false, code: 'not-checked-in', message: 'ยังไม่ได้เช็คอินวันนี้' };
  }
  if (row.clockOutAt) {
    return { ok: false, code: 'already-checked-out', message: 'คุณเช็คเอาท์วันนี้แล้ว' };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.attendance.update({
        where: { id: row.id },
        data: { clockOutAt: now },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.checkout',
        entityType: 'Attendance',
        entityId: updated.id,
        after: { clockOutAt: now.toISOString() },
        metadata: { ip, userAgent, source: 'liff' },
      });
    });
  } catch (err) {
    console.error('[submitCheckOut] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }

  const state = await getCheckInState();
  return {
    ok: true,
    state,
    // The shape demands Confirmed/Disputed; check-out is always confirmed.
    outcome: 'Confirmed',
    message: 'เช็คเอาท์สำเร็จ',
  };
}
