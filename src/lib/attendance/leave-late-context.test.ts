import { describe, expect, it } from 'vitest';
import { buildLateContext } from './leave-late-context';

/** A Bangkok (UTC+7) instant for "HH:MM" on 2026-07-15. */
const bkk = (hhmm: string) => new Date(`2026-07-15T${hhmm}:00+07:00`);
const LUNCH = { morningEnd: '12:00', afternoonStart: '13:00' };

describe('buildLateContext', () => {
  it('maps a partial-leave row to a minutes-of-day window + the lunch break', () => {
    const ctx = buildLateContext([{ clockInAt: bkk('09:00'), clockOutAt: bkk('12:00') }], LUNCH);
    expect(ctx.leaveWindows).toEqual([{ startMin: 540, endMin: 720 }]);
    expect(ctx.breakWindow).toEqual({ startMin: 720, endMin: 780 });
    expect(ctx.fullDayLeave).toBe(false);
  });

  it('treats a null-bounded row (full-day leave) as off all day', () => {
    const ctx = buildLateContext([{ clockInAt: null, clockOutAt: null }], LUNCH);
    expect(ctx.fullDayLeave).toBe(true);
  });

  it('no leave rows → empty windows, break still present, not full-day', () => {
    const ctx = buildLateContext([], LUNCH);
    expect(ctx.leaveWindows).toEqual([]);
    expect(ctx.breakWindow).toEqual({ startMin: 720, endMin: 780 });
    expect(ctx.fullDayLeave).toBe(false);
  });

  it('carries multiple partial windows through for chaining', () => {
    const ctx = buildLateContext(
      [
        { clockInAt: bkk('09:00'), clockOutAt: bkk('12:00') },
        { clockInAt: bkk('13:00'), clockOutAt: bkk('14:00') },
      ],
      LUNCH,
    );
    expect(ctx.leaveWindows).toEqual([
      { startMin: 540, endMin: 720 },
      { startMin: 780, endMin: 840 },
    ]);
  });
});
