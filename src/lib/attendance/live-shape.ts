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
  branchName: string;
  clockInAt: string | null; // ISO
  clockOutAt: string | null; // ISO
  checkInStatus: 'Confirmed' | 'Disputed' | 'Rejected' | null;
  isOverridden: boolean;
};

/** A roster member as shown in the not-checked-in list. `id` keys the chip. */
export type RosterEmployee = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  branchName: string;
};

/** An on-leave member, with the leave type + range for the chip subtitle. */
export type OnLeaveEmployee = RosterEmployee & {
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
 * Pure: roster minus the busy set, or [] on a closed day. The whole
 * "who hasn't checked in" rule — unit-tested in live-shape.test.ts.
 */
export function selectNotCheckedIn(
  roster: RosterEmployee[],
  busyEmployeeIds: ReadonlySet<string>,
  closed: boolean,
): RosterEmployee[] {
  if (closed) return [];
  return roster.filter((r) => !busyEmployeeIds.has(r.id));
}
