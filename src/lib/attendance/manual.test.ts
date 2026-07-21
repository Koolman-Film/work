/**
 * Behavioral tests for createManualAttendance — the payroll-affecting parts
 * that manual.branch.test.ts (branch-scope gate only) doesn't cover:
 *
 *   - kind:'worked' past grace writes CheckIn + derived Late, right shape
 *   - the already-checked-in guard (including the absent-over-checkin case)
 *   - bad-time / missing-exempt-reason / bad-note rejections
 *   - the late-policy / off-day resolution glue (holiday, off-schedule day)
 *
 * Mocking strategy mirrors manual.branch.test.ts exactly: mock every
 * boundary (next/*, auth, prisma, audit), then call the REAL function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ─────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ── audit mock ───────────────────────────────────────────────────────────────
const auditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  auditLog: (...a: unknown[]) => auditLog(...a),
  auditLogTx: vi.fn(),
}));

// ── auth mocks ───────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const employeeFindUnique = vi.fn();
const attendanceFindFirst = vi.fn();
const attendanceCreate = vi.fn();
const payrollConfigFindFirst = vi.fn();
const holidayFindFirst = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prismaRaw: {},
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => employeeFindUnique(...a),
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

import type { CreateManualInput } from './manual';
import { createManualAttendance } from './manual';

// ── helpers ───────────────────────────────────────────────────────────────────

function globalActorAssignments() {
  return [
    {
      branchId: null,
      role: {
        permissions: ['attendance.manual-create'],
        isSuperadmin: false,
        archivedAt: null,
      },
    },
  ];
}

const baseEmployee = {
  id: 'emp-1',
  archivedAt: null as Date | null,
  status: 'Active',
  branchId: 'branch-A',
  assignedBranchIds: [] as string[],
  workSchedule: null as {
    lateToleranceMin: number | null;
    days: { dayOfWeek: number; startTime: string; endTime: string }[];
  } | null,
};

/** Mon–Fri 09:00–18:00 schedule, 10-minute grace. */
function scheduleFor(days: number[]) {
  return {
    lateToleranceMin: 10,
    days: days.map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00' })),
  };
}

/** 2025-01-15 is a Wednesday (dow=3) — not Sunday, deterministic across TZ. */
const WEDNESDAY = '2025-01-15';

/** Configures attendanceFindFirst so the CheckIn-lookup query returns
 * `existingCheckIn`, and every other findFirst call (the "same type"
 * duplicate check) returns null. */
function mockExistingCheckIn(existingCheckIn: { id: string } | null) {
  attendanceFindFirst.mockImplementation(async (args: { where: { type: string } }) => {
    if (args.where.type === 'CheckIn') return existingCheckIn;
    return null;
  });
}

const baseInput: CreateManualInput = {
  employeeId: 'emp-1',
  date: WEDNESDAY,
  kind: 'worked',
  clockIn: '09:30',
};

describe('createManualAttendance — worked past grace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    getUserAssignments.mockResolvedValue(globalActorAssignments());
    payrollConfigFindFirst.mockResolvedValue(null); // → company default 09:00/15min
    holidayFindFirst.mockResolvedValue(null);
    mockExistingCheckIn(null);
    attendanceCreate.mockImplementation(async (args: { data: { type: string } }) => ({
      id: `att-${args.data.type}`,
      type: args.data.type,
    }));
    employeeFindUnique.mockResolvedValue({ ...baseEmployee, workSchedule: null });
  });

  it('writes both a CheckIn and a Late row with the right shape', async () => {
    const result = await createManualAttendance(baseInput);

    expect(result).toEqual({ ok: true, ids: ['att-CheckIn', 'att-Late'] });
    expect(attendanceCreate).toHaveBeenCalledTimes(2);

    const [checkInCall, lateCall] = attendanceCreate.mock.calls.map((c) => c[0]);

    expect(checkInCall.data).toMatchObject({
      type: 'CheckIn',
      source: 'Manual',
      durationMinutes: null,
      createdById: 'actor-id',
    });
    expect(checkInCall.data.clockInAt).toBeInstanceOf(Date);
    expect(checkInCall.data.checkInLat).toBeUndefined();
    expect(checkInCall.data.checkInLng).toBeUndefined();

    // 09:30 clock-in vs 09:00 start + 15min company-default grace → 30min late.
    expect(lateCall.data).toMatchObject({
      type: 'Late',
      source: 'Manual',
      durationMinutes: 30,
      createdById: 'actor-id',
      clockInAt: null,
      clockOutAt: null,
    });
    expect(lateCall.data.checkInLat).toBeUndefined();
    expect(lateCall.data.checkInLng).toBeUndefined();
  });

  it('cross-references the parent CheckIn id in the derived Late row audit entry', async () => {
    await createManualAttendance(baseInput);

    expect(auditLog).toHaveBeenCalledTimes(2);
    const [checkInAudit, lateAudit] = auditLog.mock.calls.map((c) => c[0]);

    expect(checkInAudit.entityId).toBe('att-CheckIn');
    expect(checkInAudit.after.derivedFromCheckInId).toBeUndefined();

    expect(lateAudit.entityId).toBe('att-Late');
    expect(lateAudit.after.derivedFromCheckInId).toBe('att-CheckIn');
  });
});

describe('createManualAttendance — already-checked-in guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    getUserAssignments.mockResolvedValue(globalActorAssignments());
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue(null);
    attendanceCreate.mockResolvedValue({ id: 'unexpected', type: 'unexpected' });
    employeeFindUnique.mockResolvedValue({ ...baseEmployee, workSchedule: null });
  });

  it('rejects kind:worked when a non-deleted CheckIn already exists for that employee+date', async () => {
    mockExistingCheckIn({ id: 'existing-checkin' });

    const result = await createManualAttendance(baseInput);

    expect(result).toEqual({
      ok: false,
      code: 'already-checked-in',
      message: expect.any(String),
    });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('rejects kind:absent when a non-deleted CheckIn already exists (contradictory Absent-over-CheckIn)', async () => {
    mockExistingCheckIn({ id: 'existing-checkin' });

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'absent',
    });

    expect(result).toEqual({
      ok: false,
      code: 'already-checked-in',
      message: expect.any(String),
    });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('allows kind:absent when no CheckIn exists', async () => {
    mockExistingCheckIn(null);
    attendanceCreate.mockResolvedValue({ id: 'new-absent', type: 'Absent' });

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'absent',
    });

    expect(result).toEqual({ ok: true, ids: ['new-absent'] });
    expect(attendanceCreate).toHaveBeenCalledOnce();
  });
});

describe('createManualAttendance — on-leave guard (Defect 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    getUserAssignments.mockResolvedValue(globalActorAssignments());
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue(null);
    attendanceCreate.mockImplementation(async (args: { data: { type: string } }) => ({
      id: `att-${args.data.type}`,
      type: args.data.type,
    }));
    employeeFindUnique.mockResolvedValue({ ...baseEmployee, workSchedule: null });
  });

  /** No CheckIn (so the earlier guard never fires); an OnLeave row exists
   *  for whatever `hasOnLeave` says. */
  function mockOnLeave(hasOnLeave: boolean) {
    attendanceFindFirst.mockImplementation(async (args: { where: { type: string } }) => {
      if (args.where.type === 'CheckIn') return null;
      if (args.where.type === 'OnLeave') return hasOnLeave ? { id: 'existing-leave' } : null;
      return null;
    });
  }

  it('rejects kind:absent when a non-deleted OnLeave row exists for that employee+date', async () => {
    mockOnLeave(true);

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'absent',
    });

    expect(result).toEqual({ ok: false, code: 'on-leave', message: expect.any(String) });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('allows kind:absent when no OnLeave row exists', async () => {
    mockOnLeave(false);
    attendanceCreate.mockResolvedValue({ id: 'new-absent', type: 'Absent' });

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'absent',
    });

    expect(result).toEqual({ ok: true, ids: ['new-absent'] });
    expect(attendanceCreate).toHaveBeenCalledOnce();
  });

  it('does not block kind:worked when an OnLeave row exists that day (only absent is scoped)', async () => {
    mockOnLeave(true);

    const result = await createManualAttendance(baseInput); // kind: 'worked'

    expect(result.ok).toBe(true);
    expect(attendanceCreate).toHaveBeenCalled();
  });
});

describe('createManualAttendance — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    getUserAssignments.mockResolvedValue(globalActorAssignments());
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue(null);
    mockExistingCheckIn(null);
    attendanceCreate.mockResolvedValue({ id: 'unexpected', type: 'unexpected' });
    employeeFindUnique.mockResolvedValue({ ...baseEmployee, workSchedule: null });
  });

  it('rejects kind:worked with no clockIn as bad-time', async () => {
    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'worked',
      clockIn: null,
    });

    expect(result).toEqual({ ok: false, code: 'bad-time', message: expect.any(String) });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('rejects clockOut <= clockIn as bad-time', async () => {
    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'worked',
      clockIn: '10:00',
      clockOut: '10:00',
    });

    expect(result).toEqual({ ok: false, code: 'bad-time', message: expect.any(String) });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('rejects exemptLate without exemptReason as missing-exempt-reason', async () => {
    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'worked',
      clockIn: '09:30',
      exemptLate: true,
      exemptReason: '   ',
    });

    expect(result).toEqual({
      ok: false,
      code: 'missing-exempt-reason',
      message: expect.any(String),
    });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('rejects a note over 500 chars as bad-note', async () => {
    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'absent',
      note: 'x'.repeat(501),
    });

    expect(result).toEqual({ ok: false, code: 'bad-note', message: expect.any(String) });
    expect(attendanceCreate).not.toHaveBeenCalled();
  });
});

describe('createManualAttendance — late-policy / off-day resolution glue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    getUserAssignments.mockResolvedValue(globalActorAssignments());
    mockExistingCheckIn(null);
    attendanceCreate.mockImplementation(async (args: { data: { type: string } }) => ({
      id: `att-${args.data.type}`,
      type: args.data.type,
    }));
  });

  it('produces no Late row on a holiday, even when the employee is scheduled that day', async () => {
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue({ id: 'holiday-1' }); // WEDNESDAY is a holiday
    employeeFindUnique.mockResolvedValue({
      ...baseEmployee,
      // Scheduled Mon–Fri, so Wednesday (dow=3) IS a scheduled day.
      workSchedule: scheduleFor([1, 2, 3, 4, 5]),
    });

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'worked',
      clockIn: '10:00', // well past 09:00 + 10min grace — would be late if not for the holiday
    });

    expect(result.ok).toBe(true);
    expect(attendanceCreate).toHaveBeenCalledOnce();
    expect(attendanceCreate.mock.calls[0]?.[0].data.type).toBe('CheckIn');
  });

  it("produces no Late row when the weekday is outside the employee's schedule", async () => {
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue(null);
    employeeFindUnique.mockResolvedValue({
      ...baseEmployee,
      // Scheduled Mon, Tue, Thu, Fri — Wednesday (dow=3) is NOT a scheduled day.
      workSchedule: scheduleFor([1, 2, 4, 5]),
    });

    const result = await createManualAttendance({
      employeeId: 'emp-1',
      date: WEDNESDAY,
      kind: 'worked',
      clockIn: '10:00',
    });

    expect(result.ok).toBe(true);
    expect(attendanceCreate).toHaveBeenCalledOnce();
    expect(attendanceCreate.mock.calls[0]?.[0].data.type).toBe('CheckIn');
  });
});
