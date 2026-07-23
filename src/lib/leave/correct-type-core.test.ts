import { describe, expect, it } from 'vitest';
import { computeCorrectionRipple, type RippleRequest } from './correct-type-core';

// 480 min = 1 standard day. Rate 1 baht/min keeps the arithmetic readable.
const RATE = 1;
const ent = (days: number | null) => ({
  grantedMinutes: days == null ? null : days * 480,
  carryoverMinutes: 0,
  adjustmentMinutes: 0,
  penaltyMinutes: 0,
});
const req = (o: Partial<RippleRequest> & { id: string; reviewedAtMs: number }): RippleRequest => ({
  chargedMinutes: 480,
  swept: false,
  curOverQuotaMinutes: 0,
  curDeductAmount: null,
  ...o,
});

describe('computeCorrectionRipple', () => {
  it('moves the corrected request to an unused target type → its deduction disappears', () => {
    // Old type ลากิจ: quota 0 left, so this 1-day request was fully over (480 min, ฿480).
    // New type ลาป่วย: 30 days free.
    const moved = req({
      id: 'M',
      reviewedAtMs: 100,
      curOverQuotaMinutes: 480,
      curDeductAmount: 480,
    });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [moved],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    expect(r.moved).toEqual({ leaveRequestId: 'M', overQuotaMinutes: 0, deductAmount: null });
    expect(r.netDeductDelta).toBe(-480);
  });

  it('removing a mid-group request frees a LATER same-type request', () => {
    // ลากิจ quota = 1 day (480). Three 1-day requests in approval order A,B,C.
    // Before: A within quota (0 over), B over (480, ฿480), C over (480, ฿480).
    // Move B to a free type. After: A within quota, C now takes B's old slot → C within? No:
    // used after A = 480 (quota exhausted), C over by 480. So C stays over.
    // Instead free A's successor: move A out. Then B takes the first slot (within quota),
    // C over. B goes from ฿480 → ฿0.
    const A = req({ id: 'A', reviewedAtMs: 100, curOverQuotaMinutes: 0, curDeductAmount: null });
    const B = req({ id: 'B', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const C = req({ id: 'C', reviewedAtMs: 300, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'A',
      oldGroup: [A, B, C],
      newGroup: [],
      oldEnt: ent(1),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    const byId = new Map(r.displayRows.map((x) => [x.leaveRequestId, x]));
    expect(byId.get('B')?.newDeduct).toBeNull(); // B freed
    expect(byId.get('C')?.newDeduct).toBe(480); // C still over
    expect(r.siblingWrites.find((w) => w.id === 'B')?.deductAmount).toBeNull();
  });

  it('inserting into a full target type pushes a LATER target request over quota', () => {
    // New type ลาป่วย quota = 1 day. It already has request X (reviewed at 300, within quota).
    // Move Y (reviewed at 200) into it. Y is earlier → Y takes the quota, X becomes over.
    const X = req({ id: 'X', reviewedAtMs: 300, curOverQuotaMinutes: 0, curDeductAmount: null });
    const Y = req({ id: 'Y', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'Y',
      oldGroup: [Y],
      newGroup: [X],
      oldEnt: ent(0),
      newEnt: ent(1),
      ratePerMin: RATE,
    });
    const byId = new Map(r.displayRows.map((x) => [x.leaveRequestId, x]));
    expect(byId.get('Y')?.newDeduct).toBeNull(); // Y now within quota
    expect(byId.get('X')?.newDeduct).toBe(480); // X pushed over
  });

  it('a swept sibling keeps its frozen value but still consumes quota', () => {
    // ลากิจ quota = 1 day. Swept request S (480 min, frozen ฿0 within quota) reviewed first,
    // then moved request M (over, ฿480). Move M out. S must NOT be rewritten, and S still
    // consumed the quota so nothing about S changes.
    const S = req({
      id: 'S',
      reviewedAtMs: 100,
      swept: true,
      curOverQuotaMinutes: 0,
      curDeductAmount: null,
    });
    const M = req({ id: 'M', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [S, M],
      newGroup: [],
      oldEnt: ent(1),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    expect(r.siblingWrites.some((w) => w.id === 'S')).toBe(false); // never rewrite swept
    expect(r.moved.deductAmount).toBeNull();
  });

  it('a swept sibling whose frozen value differs from a fresh replay still reports the frozen value', () => {
    // ลากิจ entitlement is now 0 days (e.g. reduced after S was approved under a
    // larger entitlement). Swept request S (480 min) was within quota when
    // approved and is frozen at over 0 / deduct null. A fresh replay of [S]
    // under ent(0) would put S at 480 over / ฿480 — but the freeze-override in
    // replayKeepingSwept must keep displayRows reporting S's frozen value.
    // (Delete the `if (src?.swept)` branch in replayKeepingSwept and this test
    // fails: displayRows would show S at over 480 / deduct 480.)
    const S = req({
      id: 'S',
      reviewedAtMs: 100,
      swept: true,
      chargedMinutes: 480,
      curOverQuotaMinutes: 0,
      curDeductAmount: null,
    });
    const M = req({ id: 'M', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [S, M],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    const sRow = r.displayRows.find((x) => x.leaveRequestId === 'S');
    expect(sRow?.newOverQuotaMinutes).toBe(0);
    expect(sRow?.newDeduct).toBeNull();
    expect(r.siblingWrites.some((w) => w.id === 'S')).toBe(false);
  });

  it('an unlimited target type never deducts', () => {
    const M = req({ id: 'M', reviewedAtMs: 100, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [M],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(null),
      ratePerMin: RATE,
    });
    expect(r.moved.deductAmount).toBeNull();
  });

  it('a target type with zero entitlement (EMP-C case) still deducts — never silently zero', () => {
    const M = req({ id: 'M', reviewedAtMs: 100, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [M],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(0),
      ratePerMin: RATE,
    });
    expect(r.moved.deductAmount).toBe(480); // moved from one 0-quota type to another
    expect(r.netDeductDelta).toBe(0);
  });
});
