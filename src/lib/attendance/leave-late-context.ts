/**
 * Build the lateness `LateContext` (approved-leave windows + lunch break)
 * from a single day's `OnLeave` attendance rows and the company lunch gap.
 *
 * This is the bridge between the leave system and late-arrival detection: an
 * employee on an approved morning half-day leave is not "late" when they show
 * up for the afternoon. Both the LIFF check-in path (check-in.ts) and the admin
 * manual-entry path (manual.ts) resolve the same context through here, so the
 * two can never disagree about whether a leave excuses a late arrival.
 *
 * Pure — the caller does the `prisma` reads (today's OnLeave rows +
 * LeaveConfig) and passes the plain data in.
 */

import { minutesOf } from '@/lib/leave/units';
import { bangkokMinutesOfDay, type LateContext, type MinuteWindow } from './late-policy';

/** The clock bounds of one OnLeave row — null on both ends for a full-day leave. */
export type OnLeaveBounds = { clockInAt: Date | null; clockOutAt: Date | null };

/** The company lunch gap, from LeaveConfig (morningEnd → afternoonStart). */
export type LunchGap = { morningEnd: string; afternoonStart: string };

export function buildLateContext(
  onLeaveRows: ReadonlyArray<OnLeaveBounds>,
  lunch: LunchGap,
): LateContext {
  // Convention (units.ts): a null-bounded OnLeave row is a FullDay leave, which
  // overlaps the whole day — the employee is off, so there is nothing to be
  // late against.
  const fullDayLeave = onLeaveRows.some((r) => r.clockInAt == null || r.clockOutAt == null);

  const leaveWindows: MinuteWindow[] = onLeaveRows
    .filter(
      (r): r is { clockInAt: Date; clockOutAt: Date } =>
        r.clockInAt != null && r.clockOutAt != null,
    )
    .map((r) => ({
      startMin: bangkokMinutesOfDay(r.clockInAt),
      endMin: bangkokMinutesOfDay(r.clockOutAt),
    }));

  const breakWindow: MinuteWindow = {
    startMin: minutesOf(lunch.morningEnd),
    endMin: minutesOf(lunch.afternoonStart),
  };

  return { leaveWindows, breakWindow, fullDayLeave };
}
