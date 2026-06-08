/**
 * Pure filter logic for the live attendance board. Kept out of the client
 * component so the "which list does this filter show" rule is unit-testable
 * (the repo convention — see status-badge.test.ts).
 */

import type {
  LiveAttendanceRow,
  LiveBoardData,
  OnLeaveEmployee,
  RosterEmployee,
} from '@/lib/attendance/live-shape';

export type AttendanceFilter = 'checkedin' | 'late' | 'notcheckedin' | 'onleave' | 'checkedout';

export const ATTENDANCE_FILTERS: readonly AttendanceFilter[] = [
  'checkedin',
  'late',
  'notcheckedin',
  'onleave',
  'checkedout',
];

/** Narrow a raw `?filter=` value to a known filter, or null (default view). */
export function parseFilter(raw: string | null | undefined): AttendanceFilter | null {
  return raw != null && (ATTENDANCE_FILTERS as readonly string[]).includes(raw)
    ? (raw as AttendanceFilter)
    : null;
}

/** A check-in is "late" if its clock-in is after 09:00 Asia/Bangkok. */
export function isLate(clockInIso: string | null): boolean {
  if (!clockInIso) return false;
  const hhmm = new Date(clockInIso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return hhmm > '09:00';
}

/** Discriminated view the client renders for the active filter. */
export type BoardView =
  | { kind: 'checkin'; rows: LiveAttendanceRow[] }
  | { kind: 'roster'; rows: RosterEmployee[] }
  | { kind: 'leave'; rows: OnLeaveEmployee[] };

/** Map the active filter to the list of items to render. */
export function selectView(data: LiveBoardData, filter: AttendanceFilter | null): BoardView {
  switch (filter) {
    case 'notcheckedin':
      return { kind: 'roster', rows: data.notCheckedIn };
    case 'onleave':
      return { kind: 'leave', rows: data.onLeave };
    case 'late':
      return { kind: 'checkin', rows: data.rows.filter((r) => isLate(r.clockInAt)) };
    case 'checkedout':
      return { kind: 'checkin', rows: data.rows.filter((r) => r.clockOutAt != null) };
    default: // 'checkedin' and null both show the full check-in list
      return { kind: 'checkin', rows: data.rows };
  }
}
