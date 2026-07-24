import { describe, expect, it } from 'vitest';
import type { LatePolicy } from './late-policy';
import { bangkokDateTime, computeManualPreview } from './manual-preview';

const POLICY: LatePolicy = { startTime: '09:00', graceMin: 15 };
const DATE = '2026-07-15';

const worked = (over: Partial<Parameters<typeof computeManualPreview>[0]> = {}) =>
  computeManualPreview({
    kind: 'worked',
    date: DATE,
    clockIn: '09:00',
    latePolicy: POLICY,
    scheduledEndTime: '18:00',
    isOffDay: false,
    ...over,
  });

const types = (r: ReturnType<typeof computeManualPreview>) => r.rows.map((x) => x.type);

describe('bangkokDateTime', () => {
  it('reads HH:MM as Bangkok local time (UTC+7)', () => {
    expect(bangkokDateTime('2026-07-15', '09:00')?.toISOString()).toBe('2026-07-15T02:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(bangkokDateTime('15-07-2026', '09:00')).toBeNull();
    expect(bangkokDateTime('2026-07-15', '9:00')).toBeNull();
  });
});

describe('computeManualPreview — absent', () => {
  it('produces a single Absent row', () => {
    const r = computeManualPreview({
      kind: 'absent',
      date: DATE,
      latePolicy: POLICY,
      isOffDay: false,
    });
    expect(types(r)).toEqual(['Absent']);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('computeManualPreview — lateness', () => {
  it('on time → CheckIn only', () => {
    const r = worked({ clockIn: '09:00' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('within grace → CheckIn only', () => {
    const r = worked({ clockIn: '09:15' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('past grace → CheckIn + Late with full minutes past start', () => {
    const r = worked({ clockIn: '09:16' });
    expect(types(r)).toEqual(['CheckIn', 'Late']);
    expect(r.lateMinutes).toBe(16);
    expect(r.rows[1]!.durationMinutes).toBe(16);
  });

  it('off day cancels lateness', () => {
    const r = worked({ clockIn: '09:45', isOffDay: true });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('null policy (not a scheduled workday) cancels lateness', () => {
    const r = worked({ clockIn: '09:45', latePolicy: null });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('exemptLate drops the Late row but keeps CheckIn and reports the minutes', () => {
    const r = worked({ clockIn: '09:45', exemptLate: true });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(45);
  });

  it('an approved morning leave + lunch break moves the late reference point', () => {
    // Leave 09:00–12:00, lunch 12:00–13:00, admin records a 12:30 clock-in.
    // Without the context it would be 210 min late; with it, on time.
    const lateContext = {
      leaveWindows: [{ startMin: 9 * 60, endMin: 12 * 60 }],
      breakWindow: { startMin: 12 * 60, endMin: 13 * 60 },
    };
    const r = worked({ clockIn: '12:30', lateContext });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });
});

describe('computeManualPreview — clock-out', () => {
  it('leaving early does NOT create EarlyLeave unless opted in', () => {
    const r = worked({ clockOut: '16:00' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.earlyLeaveMinutes).toBe(120);
  });

  it('recordEarlyLeave opts in to the EarlyLeave row', () => {
    const r = worked({ clockOut: '16:00', recordEarlyLeave: true });
    expect(types(r)).toEqual(['CheckIn', 'EarlyLeave']);
    expect(r.rows[1]!.durationMinutes).toBe(120);
  });

  it('leaving late reports OT minutes and creates no extra row', () => {
    const r = worked({ clockOut: '19:30' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.otMinutes).toBe(90);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it('no scheduled end time → no early-leave or OT signal', () => {
    const r = worked({ clockOut: '19:30', scheduledEndTime: null });
    expect(r.otMinutes).toBe(0);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it('combines Late and opted-in EarlyLeave', () => {
    const r = worked({ clockIn: '09:45', clockOut: '16:00', recordEarlyLeave: true });
    expect(types(r)).toEqual(['CheckIn', 'Late', 'EarlyLeave']);
  });

  it('off day suppresses early-leave and OT entirely, even when opted in', () => {
    // Volunteered on a holiday 09:00–14:00 against a 09:00–18:00 schedule:
    // no Late (already covered above), and no EarlyLeave/OT signal either —
    // the schedule doesn't apply on a day the employee wasn't required to
    // work, so "left early" / "worked OT" are both meaningless here.
    const r = worked({
      clockIn: '09:00',
      clockOut: '14:00',
      isOffDay: true,
      recordEarlyLeave: true,
    });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.earlyLeaveMinutes).toBe(0);
    expect(r.otMinutes).toBe(0);
    expect(r.warnings.some((w) => w.includes('ออกก่อนเวลา'))).toBe(false);
    expect(r.warnings.some((w) => w.includes('OT'))).toBe(false);
  });

  it('off day also suppresses the OT warning when clocking out later than the schedule', () => {
    const r = worked({ clockIn: '09:00', clockOut: '19:00', isOffDay: true });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.otMinutes).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});

describe('computeManualPreview — OT threshold', () => {
  it('below the configured threshold: otMinutes is still reported but no OT warning is shown', () => {
    const r = worked({ clockOut: '18:10', otThresholdMinutes: 30 });
    expect(r.otMinutes).toBe(10);
    expect(r.warnings.some((w) => w.includes('OT'))).toBe(false);
  });

  it('at/above the configured threshold: the OT warning is shown', () => {
    const r = worked({ clockOut: '18:30', otThresholdMinutes: 30 });
    expect(r.otMinutes).toBe(30);
    expect(r.warnings.some((w) => w.includes('OT'))).toBe(true);
  });

  it('defaults the threshold to 30 minutes when not provided, matching getOtCandidates', () => {
    const under = worked({ clockOut: '18:10' });
    expect(under.warnings.some((w) => w.includes('OT'))).toBe(false);
    const over = worked({ clockOut: '18:31' });
    expect(over.warnings.some((w) => w.includes('OT'))).toBe(true);
  });
});
