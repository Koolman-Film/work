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
 * Selfie path (W4-late/A):
 *   - Client compresses + uploads selfie before calling submitCheckIn,
 *     passes the resulting storage key (path within attendance-photos
 *     bucket) as `selfieKey`.
 *   - If ANY of the candidate branches has requireSelfie=true and no
 *     selfieKey was provided, we reject with 'selfie-required'. The
 *     client computes the same rule and shouldn't let this branch fire,
 *     but it's defense-in-depth against a misbehaving client.
 *   - The selfieKey must start with `${user.authUserId}/` (matching the
 *     RLS folder convention). The Storage RLS already enforces this at
 *     upload time; the server-side check just produces a clean error
 *     if a client somehow uploads to its own folder then claims the row
 *     points elsewhere.
 *
 * Deferred to W4-late/B+C:
 *   - Inngest `attendance.recorded` emission for downstream late-check.
 *   - Force-checkout cron.
 */

import { type Employee, Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { auditLogTx } from '@/lib/audit/log';
import { requireCheckInPermission, requireEmployee } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { notifyAdminsOnLine } from '@/lib/notifications/admin-line';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { bangkokDateUtcMidnight, isClosedDay } from './date';
import { type CheckInPoint, disputeReasonText, evaluateCheckIn } from './evaluate';
import { lateMinutesForCheckIn, latePolicyFrom, resolveLatePolicy } from './late-policy';

/** Display name for admin bell — prefer nickname. Mirrors leave/actions.ts. */
function employeeDisplayName(e: Pick<Employee, 'firstName' | 'lastName' | 'nickname'>): string {
  if (e.nickname && e.nickname.trim().length > 0) return e.nickname;
  return `${e.firstName} ${e.lastName}`.trim();
}

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
        | 'selfie-required'
        | 'selfie-bad-path'
        | 'db-error';
      message: string;
    };

/** Input to submitCheckIn — GPS reading + optional selfie storage key. */
export type SubmitCheckInInput = CheckInPoint & {
  /** Path within the `attendance-photos` bucket; null if no selfie required. */
  selfieKey?: string | null;
};

/** Compute YYYY-MM-DD in Asia/Bangkok regardless of server timezone. */
function bangkokDateString(d: Date): string {
  // Intl handles the timezone conversion robustly without pulling in date-fns-tz
  // for this single use. The locale produces YYYY-MM-DD when given 'sv-SE'.
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
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
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      requireSelfie: true,
      requireGps: true,
    },
  });

  return branches.map((b) => ({
    id: b.id,
    name: b.name,
    // Prisma Decimal → number for our pure math layer.
    latitude: b.latitude ? Number(b.latitude) : null,
    longitude: b.longitude ? Number(b.longitude) : null,
    radiusMeters: b.radiusMeters,
    requireSelfie: b.requireSelfie,
    requireGps: b.requireGps,
  }));
}

/** Read-only — fetches today's attendance row (if any) to drive the UI button state. */
export async function getCheckInState(): Promise<CheckInState> {
  const { employee } = await requireEmployee();

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

export async function submitCheckIn(input: SubmitCheckInInput): Promise<SubmitCheckInResult> {
  const { user, employee, authUserId } = await requireCheckInPermission();
  // Worker-facing strings are localized to the requester's locale (NEXT_LOCALE
  // cookie). `code` stays the stable machine-readable discriminant.
  const t = await getTranslations('checkin');

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
      message: t('error.alreadyCheckedIn'),
    };
  }

  // ── Selfie policy check ──────────────────────────────────────────────
  // If ANY candidate branch requires a selfie, the employee must have
  // uploaded one. Same rule as the client computes; this is the server
  // half of "client + server agree on what's required."
  const selfieRequired = candidateBranches.some((b) => b.requireSelfie);
  const selfieKey = input.selfieKey?.trim() ?? null;

  if (selfieRequired && !selfieKey) {
    return {
      ok: false,
      code: 'selfie-required',
      message: t('error.selfieRequired'),
    };
  }

  // Defense-in-depth: if a selfieKey was provided, it MUST live in the
  // caller's own authUserId folder (matches the Storage RLS convention).
  // The Storage RLS already enforces this at upload time, so the only
  // way to land here with a bad key is a misbehaving client passing a
  // string they didn't actually upload. Reject loudly.
  if (selfieKey && !selfieKey.startsWith(`${authUserId}/`)) {
    return {
      ok: false,
      code: 'selfie-bad-path',
      message: t('error.selfieBadPath'),
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

  // ── Late-arrival policy ──────────────────────────────────────────────
  // A check-in later than the scheduled start + grace records a separate
  // `Late` row (type=Late) — the unit the report, the history "มาสาย" filter,
  // and payroll deduction all read. The start time + grace come from the
  // employee's WorkSchedule for today's weekday when assigned, else the
  // company default (PayrollConfig). A check-in on an off-schedule day → never
  // late. Holidays (and Sundays, for the default path) also cancel lateness.
  const [latePolicyCfg, schedEmp] = await Promise.all([
    prisma.payrollConfig.findFirst({ select: { workStartTime: true, lateGraceMinutes: true } }),
    prisma.employee.findUnique({
      where: { id: employee.id },
      select: {
        workSchedule: {
          select: {
            lateToleranceMin: true,
            days: { select: { dayOfWeek: true, startTime: true } },
          },
        },
      },
    }),
  ]);
  const todayDow = today.getUTCDay();
  const scheduleDays = schedEmp?.workSchedule?.days ?? null;
  const hasSchedule = !!scheduleDays && scheduleDays.length > 0;
  const policy = resolveLatePolicy(
    scheduleDays,
    schedEmp?.workSchedule?.lateToleranceMin ?? null,
    todayDow,
    latePolicyFrom(latePolicyCfg),
  );
  let lateMinutes = policy ? lateMinutesForCheckIn(now, policy) : 0;
  if (lateMinutes > 0) {
    const hasHoliday =
      (await prisma.holiday.findFirst({
        where: { date: today, archivedAt: null },
        select: { id: true },
      })) != null;
    // With a schedule, working days are already defined by it — only holidays
    // cancel lateness. Without one, fall back to company closed days (Sun + holiday).
    const off = hasSchedule ? hasHoliday : isClosedDay(today, hasHoliday);
    if (off) lateMinutes = 0;
  }

  // Holder pattern: TS would narrow `let attendanceId: string | null = null`
  // to `never` inside the async closure since it can't see the assignment
  // crosses the await. Wrapping in an object disables narrowing.
  const attendanceBox: { id: string | null } = { id: null };

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
          // Storage path within attendance-photos bucket; the field is
          // named "Url" for historical reasons but we store the path
          // (URLs expire — paths don't). Admin disputed-review UI
          // regenerates fresh signed URLs at view-time.
          checkInSelfieUrl: selfieKey,
          // For LIFF check-ins the actor IS the employee — their User row's id.
          // Admin manual entries and cron rows fill this with a different actor.
          createdById: user.id,
        },
      });

      attendanceBox.id = created.id;

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
          selfieKey: selfieKey ?? null,
        },
        metadata: { ip, userAgent, source: 'liff' },
      });

      // Derived Late row. Guard against a pre-existing Late for the day
      // (e.g. an admin manual entry) — the partial-unique (employeeId, date,
      // type) index would otherwise abort the whole check-in transaction.
      if (lateMinutes > 0) {
        const existingLate = await tx.attendance.findFirst({
          where: { employeeId: employee.id, date: today, type: 'Late', deletedAt: null },
          select: { id: true },
        });
        if (!existingLate) {
          const lateRow = await tx.attendance.create({
            data: {
              employeeId: employee.id,
              date: today,
              type: 'Late',
              source: 'Liff',
              durationMinutes: lateMinutes,
              createdById: user.id,
            },
            select: { id: true },
          });
          await auditLogTx(tx, {
            actorId: user.id,
            action: 'attendance.late-auto',
            entityType: 'Attendance',
            entityId: lateRow.id,
            after: {
              type: 'Late',
              durationMinutes: lateMinutes,
              derivedFromCheckInId: created.id,
            },
            metadata: { source: 'liff-auto-late' },
          });
        }
      }
    });
  } catch (err) {
    console.error('[submitCheckIn] tx failed', err);
    return {
      ok: false,
      code: 'db-error',
      message: t('error.dbError'),
    };
  }

  // Disputed check-ins fan out an in-app bell to admins so they know to
  // open /admin/attendance/disputed. Confirmed check-ins are silent —
  // the live board already shows them, no need for a bell ping.
  if (verdict.status === 'Disputed' && attendanceBox.id) {
    void notifyAdminsInApp({
      kind: 'attendance.disputed',
      attendanceId: attendanceBox.id,
      employeeName: employeeDisplayName(employee),
      date: bangkokDateString(now),
      reason: disputeReason ?? 'unknown',
    });
    // LINE push to paired admins — same fire-and-forget contract.
    void notifyAdminsOnLine({
      kind: 'admin.dispute-submitted',
      attendanceId: attendanceBox.id,
      employeeName: employeeDisplayName(employee),
      date: bangkokDateString(now),
      reason: disputeReason ?? 'unknown',
    });
  }

  const state = await getCheckInState();
  let message: string;
  if (verdict.status === 'Confirmed') {
    message = verdict.branchName
      ? t('success.checkedInAt', { branch: verdict.branchName })
      : t('success.checkedIn');
  } else {
    // Disputed: translate the reason enum (the Thai `disputeReason` above stays
    // the single source of truth for the stored row + admin inbox).
    const r = verdict.reason;
    const reason =
      r === 'no-configured-branch'
        ? t('disputeReason.noConfiguredBranch')
        : r === 'no-branch-in-range'
          ? t('disputeReason.noBranchInRange')
          : r === 'gps-too-imprecise'
            ? t('disputeReason.gpsTooImprecise')
            : r === 'impossible-travel'
              ? t('disputeReason.impossibleTravel')
              : t('disputeReason.unknown');
    message = t('success.checkedInDisputed', { reason });
  }

  return { ok: true, state, outcome: verdict.status, message };
}

export async function submitCheckOut(): Promise<SubmitCheckInResult> {
  // For now check-out is a simple "set clockOutAt on today's row" — no
  // geofence re-check on the out side. v2 build-plan keeps it minimal in
  // W3b; W3c can layer geofence-out if we decide it's needed.
  const { user, employee } = await requireCheckInPermission();
  const t = await getTranslations('checkin');

  const now = new Date();
  const today = bangkokDateUtcMidnight(now);

  const row = await prisma.attendance.findFirst({
    where: { employeeId: employee.id, date: today, type: 'CheckIn' },
    select: { id: true, clockOutAt: true },
  });

  if (!row) {
    return { ok: false, code: 'not-checked-in', message: t('error.notCheckedIn') };
  }
  if (row.clockOutAt) {
    return { ok: false, code: 'already-checked-out', message: t('error.alreadyCheckedOut') };
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
    return { ok: false, code: 'db-error', message: t('error.dbError') };
  }

  const state = await getCheckInState();
  return {
    ok: true,
    state,
    // The shape demands Confirmed/Disputed; check-out is always confirmed.
    outcome: 'Confirmed',
    message: t('success.checkedOut'),
  };
}
