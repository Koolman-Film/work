import { describe, expect, it } from 'vitest';
import {
  deductionForOverQuota,
  overQuotaMinutesFor,
  perMinuteRate,
  replayOverQuota,
} from './over-quota';

describe('perMinuteRate', () => {
  // std day = 420 min (09:00–12:00 + 13:00–17:00), workingDaysPerMonth = 30
  it('Monthly: baseSalary / workingDays / stdDayMinutes', () => {
    expect(perMinuteRate('Monthly', 12600, 30, 420)).toBeCloseTo(1); // 12600/30/420
  });
  it('Daily: baseSalary / stdDayMinutes', () => {
    expect(perMinuteRate('Daily', 420, 30, 420)).toBeCloseTo(1);
  });
  it('Hourly: baseSalary / 60', () => {
    expect(perMinuteRate('Hourly', 60, 30, 420)).toBeCloseTo(1);
  });
});

describe('overQuotaMinutesFor', () => {
  it('null remaining (unlimited) → 0', () => {
    expect(overQuotaMinutesFor(420, null)).toBe(0);
  });
  it('within quota → 0', () => {
    expect(overQuotaMinutesFor(420, 840)).toBe(0);
  });
  it('partially over → only the excess', () => {
    expect(overQuotaMinutesFor(840, 420)).toBe(420);
  });
  it('negative remaining clamps to 0 — current charge is fully over, no retro-charge', () => {
    expect(overQuotaMinutesFor(420, -100)).toBe(420);
  });
});

describe('deductionForOverQuota', () => {
  it('rounds to 2dp', () => {
    expect(deductionForOverQuota(125, 1.2345)).toBe(154.31);
  });
  it('0 over-quota → 0', () => {
    expect(deductionForOverQuota(0, 99)).toBe(0);
  });

  // ── Money-rounding contract. These are the assertions that protect satang.
  it('rounds the .005 boundary HALF-UP via decimal.js, not the IEEE-754 float trap', () => {
    // 1 * 1.005 in IEEE-754 is 1.00499999…, so the naive `Math.round(x*100)/100`
    // rounds it DOWN to 1.00. decimal.js sees the exact 1.005 and rounds UP.
    expect(Math.round(1 * 1.005 * 100) / 100).toBe(1.0); // the bug we must NOT have
    expect(deductionForOverQuota(1, 1.005)).toBe(1.01); // the behaviour we require
  });
  it('rounds below the half-satang boundary down', () => {
    expect(deductionForOverQuota(1, 1.004)).toBe(1.0);
  });
  it('handles a realistic repeating-decimal rate (20000/30/420 ฿/min × one day)', () => {
    // One full over-quota day for a ฿20,000/mo employee = one day's pay.
    expect(deductionForOverQuota(420, 20_000 / 30 / 420)).toBe(666.67);
  });
});

describe('replayOverQuota', () => {
  const ent = (granted: number | null, adjust = 0) => ({
    grantedMinutes: granted,
    carryoverMinutes: 0,
    adjustmentMinutes: adjust,
  });

  it('charges over-quota in order — earlier requests consume the quota first', () => {
    // granted 480 (1 day). r1 480 fits; r2 60 is fully over.
    const r = replayOverQuota(
      ent(480),
      [
        { id: 'a', chargedMinutes: 480 },
        { id: 'b', chargedMinutes: 60 },
      ],
      1,
    );
    expect(r).toEqual([
      { id: 'a', overQuotaMinutes: 0, deductAmount: null },
      { id: 'b', overQuotaMinutes: 60, deductAmount: 60 },
    ]);
  });

  it('a single request that straddles the quota charges only the excess', () => {
    const r = replayOverQuota(ent(480), [{ id: 'a', chargedMinutes: 540 }], 1);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 60, deductAmount: 60 });
  });

  it('a negative effective entitlement makes every request fully over-quota', () => {
    // granted 1440 + adjustment −3600 → base −2160. Mirrors the prod ติ๋ว case.
    const r = replayOverQuota(
      ent(1440, -3600),
      [
        { id: 'a', chargedMinutes: 480 },
        { id: 'b', chargedMinutes: 180 },
      ],
      1,
    );
    expect(r[0]?.overQuotaMinutes).toBe(480);
    expect(r[1]?.overQuotaMinutes).toBe(180);
  });

  it('unlimited entitlement (granted null) → never over quota', () => {
    const r = replayOverQuota(ent(null), [{ id: 'a', chargedMinutes: 9999 }], 1);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 0, deductAmount: null });
  });

  it('applies the per-minute rate to the deduction', () => {
    const r = replayOverQuota(ent(0), [{ id: 'a', chargedMinutes: 120 }], 1.5);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 120, deductAmount: 180 });
  });

  it('carryover extends the base — granted+carryover are pooled before over-quota', () => {
    // base = 420 granted + 180 carryover = 600. r1 600 exactly fits; r2 60 over.
    const r = replayOverQuota(
      { grantedMinutes: 420, carryoverMinutes: 180, adjustmentMinutes: 0 },
      [
        { id: 'a', chargedMinutes: 600 },
        { id: 'b', chargedMinutes: 60 },
      ],
      1,
    );
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 0, deductAmount: null });
    expect(r[1]).toEqual({ id: 'b', overQuotaMinutes: 60, deductAmount: 60 });
  });

  it('a negative base from carryover+adjustment makes the whole charge over-quota', () => {
    // base = 0 granted + 100 carryover − 300 adjustment = −200 → clamps, all over.
    const r = replayOverQuota(
      { grantedMinutes: 0, carryoverMinutes: 100, adjustmentMinutes: -300 },
      [{ id: 'a', chargedMinutes: 480 }],
      1,
    );
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 480, deductAmount: 480 });
  });

  it('rounds each leaveʼs deduction INDEPENDENTLY (per-leave satang, not the aggregate)', () => {
    // Each LeaveRequest.deductAmount is frozen to its own Decimal(12,2); payroll
    // sums those rounded values. At rate 1/3, two 10-min over-quota leaves each
    // round to ฿3.33 → Σ ฿6.66, which is deliberately NOT the ฿6.67 you'd get by
    // rounding the 20-min aggregate. Locking this prevents a silent 1-satang
    // drift if anyone "optimises" to round once.
    const r = replayOverQuota(
      ent(0),
      [
        { id: 'a', chargedMinutes: 10 },
        { id: 'b', chargedMinutes: 10 },
      ],
      1 / 3,
    );
    expect(r[0]?.deductAmount).toBe(3.33);
    expect(r[1]?.deductAmount).toBe(3.33);
    expect((r[0]?.deductAmount ?? 0) + (r[1]?.deductAmount ?? 0)).toBe(6.66);
    expect(deductionForOverQuota(20, 1 / 3)).toBe(6.67); // the aggregate we avoid
  });
});

describe('replayOverQuota — order invariants (money safety net)', () => {
  // Attribution of over-quota to individual requests is order-DEPENDENT, but the
  // TOTAL over-quota minutes for a group is order-INVARIANT. The total is what
  // ultimately leaves an employee's pay, so it must never depend on the (mutable)
  // approval order. Property: totalOver === max(0, ΣchargedMinutes − max(0, base)).
  const totalOver = (rs: ReturnType<typeof replayOverQuota>) =>
    rs.reduce((s, x) => s + x.overQuotaMinutes, 0);

  it('same total over-quota regardless of approval order, different attribution', () => {
    const ent = { grantedMinutes: 500, carryoverMinutes: 0, adjustmentMinutes: 0 };
    const forward = replayOverQuota(
      ent,
      [
        { id: 'big', chargedMinutes: 600 },
        { id: 'small', chargedMinutes: 100 },
      ],
      1,
    );
    const reversed = replayOverQuota(
      ent,
      [
        { id: 'small', chargedMinutes: 100 },
        { id: 'big', chargedMinutes: 600 },
      ],
      1,
    );
    // Attribution differs with order…
    expect(forward.find((x) => x.id === 'big')?.overQuotaMinutes).toBe(100);
    expect(reversed.find((x) => x.id === 'big')?.overQuotaMinutes).toBe(200);
    // …but the group total is identical and equals max(0, 700 − 500).
    expect(totalOver(forward)).toBe(200);
    expect(totalOver(reversed)).toBe(200);
  });

  it('total = ΣchargedMinutes when the base is negative (no quota to absorb any)', () => {
    const ent = { grantedMinutes: 0, carryoverMinutes: 0, adjustmentMinutes: -50 };
    const reqs = [
      { id: 'a', chargedMinutes: 120 },
      { id: 'b', chargedMinutes: 300 },
      { id: 'c', chargedMinutes: 60 },
    ];
    const a = replayOverQuota(ent, reqs, 1);
    const b = replayOverQuota(ent, [...reqs].reverse(), 1);
    expect(totalOver(a)).toBe(480); // 120 + 300 + 60, all over
    expect(totalOver(b)).toBe(480);
  });
});
