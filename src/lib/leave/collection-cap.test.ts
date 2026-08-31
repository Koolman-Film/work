import { describe, expect, it } from 'vitest';
import { capLeaveCollection, monthlyLeaveCap } from './collection-cap';

describe('monthlyLeaveCap', () => {
  it('is a percentage of base salary', () => {
    expect(monthlyLeaveCap(13_500, 30)).toBe(4_050);
  });

  it('0 percent means NO cap, not "collect nothing"', () => {
    // The distinction matters: a 0 that meant "collect nothing" would silently
    // stop all leave recovery the moment someone cleared the field.
    expect(monthlyLeaveCap(13_500, 0)).toBeNull();
  });

  it('rounds to satang', () => {
    expect(monthlyLeaveCap(13_333, 30)).toBe(3_999.9);
  });

  it('a zero or unknown salary yields no cap rather than a zero cap', () => {
    expect(monthlyLeaveCap(0, 30)).toBeNull();
  });
});

describe('capLeaveCollection', () => {
  const reqs = [
    { id: 'a', outstanding: 1_800 },
    { id: 'b', outstanding: 23_850 },
  ];

  it('with no cap, collects everything outstanding', () => {
    expect(capLeaveCollection(reqs, null)).toEqual([
      { id: 'a', collect: 1_800, fullySettled: true },
      { id: 'b', collect: 23_850, fullySettled: true },
    ]);
  });

  it('fills the cap in order, splitting the request that straddles it', () => {
    // THE case this exists for: a single 23,850 request against a 4,050 cap
    // must be collected PARTIALLY. Whole-request-only would collect nothing
    // here, every month, forever.
    expect(capLeaveCollection(reqs, 4_050)).toEqual([
      { id: 'a', collect: 1_800, fullySettled: true },
      { id: 'b', collect: 2_250, fullySettled: false },
    ]);
  });

  it('a request larger than the whole cap is still partly collected', () => {
    expect(capLeaveCollection([{ id: 'b', outstanding: 23_850 }], 4_050)).toEqual([
      { id: 'b', collect: 4_050, fullySettled: false },
    ]);
  });

  it('stops once the cap is spent, leaving later requests untouched', () => {
    const out = capLeaveCollection(
      [
        { id: 'a', outstanding: 4_050 },
        { id: 'b', outstanding: 500 },
      ],
      4_050,
    );
    expect(out).toEqual([{ id: 'a', collect: 4_050, fullySettled: true }]);
  });

  it('omits requests with nothing outstanding', () => {
    expect(capLeaveCollection([{ id: 'a', outstanding: 0 }], null)).toEqual([]);
  });

  it('never collects a negative amount', () => {
    // Defensive: an over-collected row (collected > derived, e.g. after a
    // waiver reduced the charge) must not claw money BACK out of a payslip.
    expect(capLeaveCollection([{ id: 'a', outstanding: -500 }], null)).toEqual([]);
  });

  it('a zero cap collects nothing — distinct from a null cap', () => {
    expect(capLeaveCollection(reqs, 0)).toEqual([]);
  });

  it('rounds each collection to satang', () => {
    const out = capLeaveCollection([{ id: 'a', outstanding: 100 }], 33.333);
    expect(out).toEqual([{ id: 'a', collect: 33.33, fullySettled: false }]);
  });
});
