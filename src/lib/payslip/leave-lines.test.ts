import { describe, expect, it } from 'vitest';
import { itemiseLeaveCharges, type SweptLeaveCharge } from './leave-lines';

const charge = (o: Partial<SweptLeaveCharge> = {}): SweptLeaveCharge => ({
  id: 'a',
  startDate: '2026-09-05',
  endDate: '2026-09-05',
  overQuotaMinutes: 480,
  amount: 450,
  leaveType: { name: 'ลากิจ', nameByLocale: null },
  ...o,
});

describe('itemiseLeaveCharges', () => {
  it('itemises when the parts sum to the frozen total', () => {
    const lines = itemiseLeaveCharges([charge({ id: 'a' }), charge({ id: 'b', amount: 300 })], 750);
    expect(lines?.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('sorts chronologically so an old backlog charge reads first', () => {
    const lines = itemiseLeaveCharges(
      [
        charge({ id: 'new', startDate: '2026-09-20', amount: 100 }),
        charge({ id: 'backlog', startDate: '2025-11-03', amount: 100 }),
      ],
      200,
    );
    expect(lines?.map((l) => l.id)).toEqual(['backlog', 'new']);
  });

  it('falls back to the aggregate when the parts do not sum to the frozen total', () => {
    // The instalment case: the cap collected ฿450 of a ฿900 request, so the
    // stamped request overstates what this month actually took.
    expect(itemiseLeaveCharges([charge({ amount: 900 })], 450)).toBeNull();
  });

  it('falls back when a collected month has no stamped request at all', () => {
    // The other half of the instalment case — money deducted, nothing stamped.
    expect(itemiseLeaveCharges([], 450)).toBeNull();
  });

  it('is null when there is no leave charge and no leave deduction', () => {
    expect(itemiseLeaveCharges([], 0)).toBeNull();
  });

  it('shows no line at all for a zero bucket, even with a stamped request', () => {
    // A ฿0.00 line reads as a charge. A month that deducted nothing for leave
    // must stay silent, exactly as the aggregate line does.
    expect(itemiseLeaveCharges([charge({ amount: 0, overQuotaMinutes: 0 })], 0)).toBeNull();
  });

  it('tolerates float noise at the stored 2dp', () => {
    const lines = itemiseLeaveCharges(
      [charge({ id: 'a', amount: 466.67 }), charge({ id: 'b', amount: 33.33 })],
      500,
    );
    expect(lines).toHaveLength(2);
  });

  it('does not mutate the caller list while sorting', () => {
    const input = [charge({ id: 'b', startDate: '2026-09-20' }), charge({ id: 'a', amount: 300 })];
    itemiseLeaveCharges(input, 750);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('breaks a same-day tie by id so the order is stable across renders', () => {
    const lines = itemiseLeaveCharges(
      [charge({ id: 'z', amount: 100 }), charge({ id: 'a', amount: 100 })],
      200,
    );
    expect(lines?.map((l) => l.id)).toEqual(['a', 'z']);
  });
});
