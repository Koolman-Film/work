/**
 * Behavioral tests for submitCheckIn's dispute-notification + audit wiring
 * (fix wave item 1+2 on branch fix/advance-payout-selfie-provenance):
 *
 *   - A check-in Disputed ONLY by selfie provenance (GPS was fine) must
 *     still fan out notifyAdminsInApp — the whole point of the flag is
 *     that a human looks at it. Previously the notification guard read
 *     `verdict.status` (GPS-only), so a selfie-only flag landed in the
 *     review queue but notified nobody. (The admin LINE push this test
 *     used to also assert on has since moved to the 09:30 daily digest —
 *     see admin-daily-digest.ts — so submitCheckIn no longer fires one.)
 *   - The notification `reason` must be the RESOLVED disputeReason — a
 *     selfie-only flag must report the selfie reason, never 'unknown' or a
 *     GPS string it doesn't have.
 *   - The audit log's `after.status`/`after.disputeReason` must match the
 *     resolved status actually stored on the Attendance row (not the
 *     GPS-only verdict), and `after.selfieCapture` must always be present
 *     — that field is the only record of fallback-camera usage anywhere
 *     in the system.
 *   - A GPS-Disputed check-in must keep the GPS reason even when the
 *     selfie was a fallback capture (the flag only ADDS scrutiny, never
 *     downgrades a more specific GPS reason).
 *   - A Confirmed (live capture, good GPS) check-in stays silent — no
 *     notifications — matching existing behavior.
 *
 * Mocking strategy mirrors manual.test.ts: mock every I/O boundary
 * (next/*, auth, prisma, audit, notifications), then call the REAL
 * submitCheckIn — including the REAL evaluateCheckIn/resolveCheckInStatus
 * pure logic, so the resolved status/reason are genuine, not stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bangkokDateUtcMidnight } from './date';
import { disputeReasonText } from './evaluate';
import { SELFIE_FALLBACK_REASON } from './selfie-provenance';

// ── next/* mocks ─────────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async () => (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

// ── audit mock ───────────────────────────────────────────────────────────────
const auditLogTx = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  auditLog: vi.fn(),
  auditLogTx: (...a: unknown[]) => auditLogTx(...a),
}));

// ── auth mocks ───────────────────────────────────────────────────────────────
const requireCheckInPermission = vi.fn();
const requireEmployee = vi.fn();
vi.mock('@/lib/auth/require-role', () => ({
  requireCheckInPermission: (...a: unknown[]) => requireCheckInPermission(...a),
  requireEmployee: (...a: unknown[]) => requireEmployee(...a),
}));

// ── notification mocks ───────────────────────────────────────────────────────
const notifyAdminsInApp = vi.fn();
vi.mock('@/lib/notifications/in-app-bell', () => ({
  notifyAdminsInApp: (...a: unknown[]) => notifyAdminsInApp(...a),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const employeeFindUnique = vi.fn();
const branchFindMany = vi.fn();
const attendanceFindFirst = vi.fn();
const attendanceCreate = vi.fn();
const payrollConfigFindFirst = vi.fn();
const holidayFindFirst = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => employeeFindUnique(...a),
    },
    branch: {
      findMany: (...a: unknown[]) => branchFindMany(...a),
    },
    payrollConfig: {
      findFirst: (...a: unknown[]) => payrollConfigFindFirst(...a),
    },
    holiday: {
      findFirst: (...a: unknown[]) => holidayFindFirst(...a),
    },
    attendance: {
      findFirst: (...a: unknown[]) => attendanceFindFirst(...a),
      create: (...a: unknown[]) => attendanceCreate(...a),
    },
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        attendance: {
          create: (...a: unknown[]) => attendanceCreate(...a),
        },
      }),
  },
}));

import { submitCheckIn } from './check-in';

// ── fixtures ──────────────────────────────────────────────────────────────────

const AUTH_USER_ID = 'auth-uid-1';
const BRANCH = {
  id: 'branch-1',
  name: 'สาขาทดสอบ',
  latitude: 13.7563,
  longitude: 100.5018,
  radiusMeters: 100,
  requireSelfie: true,
  requireGps: true,
};

// A weekday that is guaranteed NOT to match today's actual Bangkok weekday,
// so the schedule lookup resolves to "off-schedule day" → lateMinutes stays
// 0 regardless of what real wall-clock time the test happens to run at.
const TODAY_DOW = bangkokDateUtcMidnight(new Date()).getUTCDay();
const MISMATCHED_DOW = (TODAY_DOW + 1) % 7;

function baseEmployee() {
  return {
    id: 'emp-1',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: null,
    branchId: BRANCH.id,
    assignedBranchIds: [] as string[],
    workSchedule: {
      lateToleranceMin: 10,
      days: [{ dayOfWeek: MISMATCHED_DOW, startTime: '09:00' }],
    },
  };
}

function baseInput(overrides: Partial<Parameters<typeof submitCheckIn>[0]> = {}) {
  return {
    lat: BRANCH.latitude,
    lng: BRANCH.longitude,
    accuracy: 10,
    selfieKey: `${AUTH_USER_ID}/selfie.jpg`,
    selfieCapture: 'live' as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCheckInPermission.mockResolvedValue({
    user: { id: 'actor-1' },
    employee: { id: 'emp-1', firstName: 'สมชาย', lastName: 'ใจดี', nickname: null },
    authUserId: AUTH_USER_ID,
  });
  requireEmployee.mockResolvedValue({ employee: { id: 'emp-1' } });
  employeeFindUnique.mockResolvedValue(baseEmployee());
  branchFindMany.mockResolvedValue([BRANCH]);
  attendanceFindFirst.mockResolvedValue(null); // no existing check-in / state row
  attendanceCreate.mockResolvedValue({ id: 'att-1' });
  payrollConfigFindFirst.mockResolvedValue(null);
  holidayFindFirst.mockResolvedValue(null);
});

describe('submitCheckIn — selfie-only dispute notifies admins', () => {
  it('fallback capture + good GPS → Disputed, notifies admins with the SELFIE reason (not "unknown")', async () => {
    const result = await submitCheckIn(baseInput({ selfieCapture: 'fallback' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('Disputed');

    // The bug: this notification guard used to read `verdict.status`
    // (GPS-only), so a selfie-only flag never fired it.
    expect(notifyAdminsInApp).toHaveBeenCalledTimes(1);
    expect(notifyAdminsInApp).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'attendance.disputed', reason: SELFIE_FALLBACK_REASON }),
    );
  });

  it('records the Attendance row and audit log as Disputed with the selfie dispute reason + selfieCapture', async () => {
    await submitCheckIn(baseInput({ selfieCapture: 'fallback' }));

    expect(attendanceCreate).toHaveBeenCalledTimes(1);
    const createData = attendanceCreate.mock.calls[0]![0].data;
    expect(createData.checkInStatus).toBe('Disputed');
    expect(createData.disputeReason).toBe(SELFIE_FALLBACK_REASON);

    const checkinAudit = auditLogTx.mock.calls.find(
      (c) => c[1].action === 'attendance.checkin',
    )![1];
    // Auditing `verdict.status` here would wrongly say 'Confirmed' — GPS was
    // fine; only the selfie flag disputed this row.
    expect(checkinAudit.after.status).toBe('Disputed');
    expect(checkinAudit.after.disputeReason).toBe(SELFIE_FALLBACK_REASON);
    expect(checkinAudit.after.selfieCapture).toBe('fallback');
  });
});

describe('submitCheckIn — GPS dispute reason is never overwritten by the selfie flag', () => {
  it('out-of-range GPS + fallback capture → keeps the GPS reason, notifies with the GPS reason', async () => {
    const farAway = { lat: 14.9, lng: 102.1, accuracy: 10 }; // far outside BRANCH's 100m radius
    const result = await submitCheckIn(baseInput({ ...farAway, selfieCapture: 'fallback' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('Disputed');

    const gpsReason = disputeReasonText('no-branch-in-range');
    expect(gpsReason).not.toBe(SELFIE_FALLBACK_REASON);

    const createData = attendanceCreate.mock.calls[0]![0].data;
    expect(createData.disputeReason).toBe(gpsReason);

    expect(notifyAdminsInApp).toHaveBeenCalledWith(expect.objectContaining({ reason: gpsReason }));

    const checkinAudit = auditLogTx.mock.calls.find(
      (c) => c[1].action === 'attendance.checkin',
    )![1];
    expect(checkinAudit.after.selfieCapture).toBe('fallback');
  });
});

describe('submitCheckIn — Confirmed check-ins stay silent', () => {
  it('live capture + good GPS → Confirmed, no admin notifications, audit still records selfieCapture', async () => {
    const result = await submitCheckIn(baseInput({ selfieCapture: 'live' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('Confirmed');

    expect(notifyAdminsInApp).not.toHaveBeenCalled();

    const checkinAudit = auditLogTx.mock.calls.find(
      (c) => c[1].action === 'attendance.checkin',
    )![1];
    expect(checkinAudit.after.status).toBe('Confirmed');
    expect(checkinAudit.after.disputeReason).toBeNull();
    expect(checkinAudit.after.selfieCapture).toBe('live');
  });
});
