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
});
