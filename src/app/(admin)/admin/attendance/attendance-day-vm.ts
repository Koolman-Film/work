import type { DayGroup } from '@/lib/attendance/day-groups';
import type { AttendanceRowVM } from './attendance-row-vm';

/**
 * One table line per (employee, day), built from that day's separate rows.
 *
 * The customer's complaint was that a late arrival appears twice — a `CheckIn`
 * line and a `Late` line — so the same day has to be read in two places. The
 * rows stay separate in the database (see lib/attendance/day-groups.ts for why
 * merging them in storage would break payroll); this merges the VIEW.
 *
 * Pure, so the merge rules are testable without rendering anything.
 */
export type AttendanceDayVM = {
  key: string;
  /** The row a click opens. CheckIn when the day has one, else the first row —
   *  see `primary` below for why that is enough. */
  primary: AttendanceRowVM;
  dateLabel: string;
  name: string;
  nickname: string | null;
  /** Every type present that day, in row order: CheckIn, Late, OnLeave… */
  badges: Array<{ id: string; label: string; cls: string }>;
  /** "08:01 – 17:05" from the day's CheckIn row, when there is one. */
  timeLabel: string | null;
  /** Minutes late, surfaced ON the merged line so the Late row need not be
   *  opened separately — the point of the merge. */
  lateLabel: string | null;
  durationLabel: string;
  sourceLabel: string;
  checkInBranchName: string | null;
  note: string | null;
  isDisputed: boolean;
};

/** Prefer the CheckIn row as the day's anchor: it carries the clock times,
 *  selfie, geofence and branch that the detail modal is mostly about. A day
 *  with no CheckIn (pure OnLeave/Absent) anchors on its first row. */
function pickPrimary(rows: AttendanceRowVM[]): AttendanceRowVM {
  return rows.find((r) => r.type === 'CheckIn') ?? rows[0]!;
}

export function buildAttendanceDayVM(
  group: DayGroup<AttendanceRowVM>,
  opts: { isTrash: boolean },
): AttendanceDayVM {
  const rows = group.rows;
  const primary = pickPrimary(rows);
  const checkIn = rows.find((r) => r.type === 'CheckIn') ?? null;
  const late = rows.find((r) => r.type === 'Late') ?? null;

  return {
    key: group.key,
    primary,
    dateLabel: primary.dateLabel,
    name: primary.name,
    nickname: primary.nickname,
    badges: rows.map((r) => ({ id: r.id, label: r.typeLabel, cls: r.typeCls })),
    timeLabel: checkIn?.timeLabel ?? primary.timeLabel,
    // The Late row's durationLabel IS the lateness ("30 นาที"); reading it off
    // that row rather than recomputing keeps one source of truth.
    lateLabel: late ? late.durationLabel : null,
    // A merged day's "duration" is the worked span, so prefer the CheckIn row's
    // — the Late row's duration is already shown as lateLabel and would
    // otherwise appear twice under two different meanings.
    durationLabel: checkIn?.durationLabel ?? primary.durationLabel,
    sourceLabel: primary.sourceLabel,
    checkInBranchName: primary.checkInBranchName,
    note:
      rows
        .map((r) => (opts.isTrash ? r.deleteReason : r.disputeReason))
        .find((n) => n != null && n !== '') ?? null,
    isDisputed: rows.some((r) => r.isDisputed),
  };
}
