/**
 * Behavioral tests for submitCheckIn's dispute-notification + audit wiring.
 *
 *   - GPS is the sole author of a dispute. A fallback selfie capture is
 *     AUDITED but never disputes and never notifies. It briefly did both,
 *     which auto-disputed ~16% of check-ins from employees standing inside
 *     the geofence whose phone camera permission was off — see
 *     selfie-provenance.ts for the production evidence.
 *   - A GPS-Disputed check-in fans out notifyAdminsInApp with the GPS
 *     reason. (The admin LINE push this test used to also assert on has
 *     since moved to the 08:30 daily digest — see admin-daily-digest.ts —
 *     so submitCheckIn no longer fires one.)
 *   - `after.selfieCapture` is always present in the audit log: it is the
 *     only record of fallback-camera usage anywhere in the system, and the
 *     only reason the 16% figure above is knowable.
 *   - A Confirmed check-in stays silent — no notifications.
 *
 * Mocking strategy mirrors manual.test.ts: mock every I/O boundary
 * (next/*, auth, prisma, audit, notifications), then call the REAL
 * submitCheckIn — including the REAL evaluateCheckIn pure logic, so the
 * status/reason are genuine, not stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bangkokDateUtcMidnight } from './date';
import { disputeReasonText } from './evaluate';

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
const attendanceFindMany = vi.fn();
const attendanceCreate = vi.fn();
const payrollConfigFindFirst = vi.fn();
const holidayFindFirst = vi.fn();
const leaveConfigFindFirst = vi.fn();

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
    leaveConfig: {
      findFirst: (...a: unknown[]) => leaveConfigFindFirst(...a),
    },
    attendance: {
      findFirst: (...a: unknown[]) => attendanceFindFirst(...a),
      findMany: (...a: unknown[]) => attendanceFindMany(...a),
      create: (...a: unknown[]) => attendanceCreate(...a),
    },
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        attendance: {
          findFirst: (...a: unknown[]) => attendanceFindFirst(...a),
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
  attendanceFindFirst.mockResolvedValue(null); // no existing check-in / state / Late row
  attendanceFindMany.mockResolvedValue([]); // no OnLeave rows today
  attendanceCreate.mockResolvedValue({ id: 'att-1' });
  payrollConfigFindFirst.mockResolvedValue(null);
  holidayFindFirst.mockResolvedValue(null);
  leaveConfigFindFirst.mockResolvedValue({
    morningStart: '09:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  });
});

describe('submitCheckIn — a fallback selfie never disputes on its own', () => {
  // Regression: on 20 Jul 2026 this path auto-disputed ~16% of all check-ins.
  // The affected employees were inside the geofence; their phones simply had
  // the camera permission denied, which the OS remembers forever — so the
  // same honest people hit the admin queue every single day.
  it('fallback capture + good GPS → Confirmed, and does NOT wake an admin', async () => {
    const result = await submitCheckIn(baseInput({ selfieCapture: 'fallback' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('Confirmed');
    expect(notifyAdminsInApp).not.toHaveBeenCalled();
  });

  it('stores no dispute on the row, but still audits the capture', async () => {
    await submitCheckIn(baseInput({ selfieCapture: 'fallback' }));

    expect(attendanceCreate).toHaveBeenCalledTimes(1);
    const createData = attendanceCreate.mock.calls[0]![0].data;
    expect(createData.checkInStatus).toBe('Confirmed');
    expect(createData.disputeReason).toBeNull();

    const checkinAudit = auditLogTx.mock.calls.find(
      (c) => c[1].action === 'attendance.checkin',
    )![1];
    expect(checkinAudit.after.status).toBe('Confirmed');
    expect(checkinAudit.after.disputeReason).toBeNull();
    // The signal survives the policy change — this is where the 16% came from.
    expect(checkinAudit.after.selfieCapture).toBe('fallback');
  });
});

describe('submitCheckIn — GPS is the sole author of a dispute', () => {
  it('out-of-range GPS + fallback capture → Disputed on the GPS reason alone', async () => {
    const farAway = { lat: 14.9, lng: 102.1, accuracy: 10 }; // far outside BRANCH's 100m radius
    const result = await submitCheckIn(baseInput({ ...farAway, selfieCapture: 'fallback' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('Disputed');

    const gpsReason = disputeReasonText('no-branch-in-range');

    const createData = attendanceCreate.mock.calls[0]![0].data;
    expect(createData.disputeReason).toBe(gpsReason);

    expect(notifyAdminsInApp).toHaveBeenCalledWith(expect.objectContaining({ reason: gpsReason }));

    const checkinAudit = auditLogTx.mock.calls.find(
      (c) => c[1].action === 'attendance.checkin',
    )![1];
    expect(checkinAudit.after.selfieCapture).toBe('fallback');
  });
});

describe('submitCheckIn — an approved leave excuses lateness', () => {
  // A scheduled day starting 00:00 with zero grace makes ANY check-in late by a
  // positive amount, deterministically — independent of the wall-clock time the
  // test happens to run at — so we can prove leave suppresses the Late row.
  function alwaysLateEmployee() {
    return {
      ...baseEmployee(),
      workSchedule: { lateToleranceMin: 0, days: [{ dayOfWeek: TODAY_DOW, startTime: '00:00' }] },
    };
  }
  const lateRowCreate = () => attendanceCreate.mock.calls.find((c) => c[0]!.data.type === 'Late');

  it('with no approved leave, a late check-in still writes a Late row', async () => {
    employeeFindUnique.mockResolvedValue(alwaysLateEmployee());
    attendanceFindMany.mockResolvedValue([]);

    await submitCheckIn(baseInput());

    expect(lateRowCreate()).toBeDefined();
  });

  it('a full-day approved leave suppresses the Late row entirely', async () => {
    employeeFindUnique.mockResolvedValue(alwaysLateEmployee());
    // A FullDay OnLeave row carries null clock bounds (units.ts convention).
    attendanceFindMany.mockResolvedValue([{ clockInAt: null, clockOutAt: null }]);

    await submitCheckIn(baseInput());

    expect(lateRowCreate()).toBeUndefined();
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
