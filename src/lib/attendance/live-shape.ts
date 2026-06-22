/**
 * Data shapes + pure logic for the live attendance board. Kept OUT of live.ts
 * because that file is a `'use server'` module (Server Actions), which may only
 * export async functions — the pure, synchronous `selectNotCheckedIn` and the
 * type definitions live here so they can be imported anywhere (including client
 * components) and unit-tested without a DB.
 */

export type LiveAttendanceRow = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  /** Signed profile-photo URL (re-signed on every fetch/poll); null = no photo. */
  photoUrl: string | null;
  /** Branch this row is GROUPED under = where they checked in (geofence match),
   *  falling back to home branch when no check-in branch was recorded. */
  branchName: string;
  /** Employee's home branch. When it differs from `branchName`, the employee
   *  checked in at a branch other than their own (a roving / cross-branch
   *  visit) — the chip surfaces this so the grouping doesn't read as a bug. */
  homeBranchName: string;
  clockInAt: string | null; // ISO
  clockOutAt: string | null; // ISO
  checkInStatus: 'Confirmed' | 'Disputed' | 'Rejected' | null;
  isOverridden: boolean;
};

/** Shared chip fields for the roster + on-leave lists. `id` keys the chip. */
export type EmployeeChip = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  /** Signed profile-photo URL (re-signed on every fetch/poll); null = no photo. */
  photoUrl: string | null;
  branchName: string;
};

/** A roster member as shown in the not-checked-in list. */
export type RosterEmployee = EmployeeChip & {
  /** True if today is a working day for this employee (their WorkSchedule, or
   *  the company default). Off-schedule employees aren't "ยังไม่เช็คอิน". */
  scheduledToday: boolean;
};

/** An on-leave member, with the leave type + range for the chip subtitle. */
export type OnLeaveEmployee = EmployeeChip & {
  leaveTypeName: string | null;
  startDate: string | null; // ISO date
  endDate: string | null; // ISO date
};

export type LiveBoardData = {
  rows: LiveAttendanceRow[];
  /** Active canCheckIn employees with no CheckIn & no OnLeave today; [] on closed days. */
  notCheckedIn: RosterEmployee[];
  /** Today's OnLeave employees (name + leave type + range). */
  onLeave: OnLeaveEmployee[];
  /** Active canCheckIn roster size — the denominator for "เข้างานแล้ว %". */
  activeCount: number;
  /** OnLeave count for the "ลา/หยุด" tile (== onLeave.length). */
  onLeaveCount: number;
  /** Sunday or holiday — nobody is expected to check in. */
  isClosedDay: boolean;
};

/**
 * Pure: who hasn't checked in = roster members who are scheduled to work today
 * and aren't already busy (checked-in or on-leave). Off-schedule employees
 * (their `scheduledToday` is false — including company closed days) are never
 * "ยังไม่เช็คอิน". Unit-tested in live-shape.test.ts.
 */
export function selectNotCheckedIn(
  roster: RosterEmployee[],
  busyEmployeeIds: ReadonlySet<string>,
): RosterEmployee[] {
  return roster.filter((r) => r.scheduledToday && !busyEmployeeIds.has(r.id));
}
