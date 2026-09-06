import { describe, expect, it } from 'vitest';
import {
  filterApprovalCards,
  mapAdvanceCard,
  mapDisputedCard,
  mapLeaveCard,
  sortApprovalCardsDesc,
  waitingDays,
} from './cards';

const emp = {
  firstName: 'สม',
  lastName: 'ชาย',
  nickname: 'หนึ่ง',
  branch: { name: 'สาขา A' },
  department: { name: 'ครัว' },
};

describe('mapLeaveCard', () => {
  it('builds a leave card with range and createdAt as submittedAt', () => {
    const c = mapLeaveCard({
      id: 'l1',
      createdAt: new Date('2026-07-01T03:00:00Z'),
      startDate: new Date('2026-07-10T00:00:00Z'),
      endDate: new Date('2026-07-11T00:00:00Z'),
      leaveType: { name: 'ลาป่วย' },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('leave');
    expect(c).toMatchObject({
      id: 'l1',
      employeeName: 'สม ชาย',
      branch: 'สาขา A',
      leaveType: 'ลาป่วย',
    });
    expect(c.submittedAt).toEqual(new Date('2026-07-01T03:00:00Z'));
    expect(typeof (c as { range: string }).range).toBe('string');
  });
});

describe('mapAdvanceCard', () => {
  it('formats amount and uses requestedAt as submittedAt', () => {
    const c = mapAdvanceCard({
      id: 'a1',
      amount: 2500,
      requestedAt: new Date('2026-07-02T03:00:00Z'),
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('advance');
    expect((c as { amount: string }).amount).toContain('2,500');
    expect(c.submittedAt).toEqual(new Date('2026-07-02T03:00:00Z'));
  });
});

describe('mapDisputedCard', () => {
  it('computes distance, clock-in label, and reason fallback', () => {
    const c = mapDisputedCard({
      id: 'd1',
      clockInAt: new Date('2026-07-03T02:30:00Z'), // 09:30 Bangkok
      checkInLat: 13.7573,
      checkInLng: 100.5018,
      disputeReason: null,
      checkInBranch: { latitude: 13.7563, longitude: 100.5018 },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('disputed');
    const card = c as { distanceMeters: number | null; clockInLabel: string; reason: string };
    expect(card.distanceMeters).toBeGreaterThan(90);
    expect(card.clockInLabel).toContain('09:30');
    expect(card.reason).toBe('ไม่ระบุ');
  });
  it('is null distance when coords are missing', () => {
    const c = mapDisputedCard({
      id: 'd2',
      clockInAt: new Date('2026-07-03T02:30:00Z'),
      checkInLat: null,
      checkInLng: null,
      disputeReason: 'นอกพื้นที่',
      checkInBranch: { latitude: 13.75, longitude: 100.5 },
      employee: { ...emp, branchId: 'b1' },
    });
    expect((c as { distanceMeters: number | null }).distanceMeters).toBeNull();
    expect((c as { reason: string }).reason).toBe('นอกพื้นที่');
  });

  it('does not throw and is null distance when checkInBranch coords are null (geofence pin cleared)', () => {
    const c = mapDisputedCard({
      id: 'd4',
      clockInAt: new Date('2026-07-03T02:30:00Z'), // 09:30 Bangkok
      checkInLat: 13.7573,
      checkInLng: 100.5018,
      disputeReason: null,
      checkInBranch: { latitude: null, longitude: null },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('disputed');
    const card = c as { distanceMeters: number | null; clockInLabel: string };
    expect(card.distanceMeters).toBeNull();
    expect(card.clockInLabel).toContain('09:30');
  });

  it('does not throw and is null distance when checkInBranch is null (no-configured-branch dispute)', () => {
    const c = mapDisputedCard({
      id: 'd3',
      clockInAt: new Date('2026-07-03T02:30:00Z'), // 09:30 Bangkok
      checkInLat: 13.7573,
      checkInLng: 100.5018,
      disputeReason: 'no-configured-branch',
      checkInBranch: null,
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('disputed');
    const card = c as { distanceMeters: number | null; clockInLabel: string };
    expect(card.distanceMeters).toBeNull();
    expect(card.clockInLabel).toContain('09:30');
  });
});

describe('filterApprovalCards', () => {
  const cards = [
    mapLeaveCard({
      id: 'l1',
      createdAt: new Date('2026-07-01'),
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-10'),
      leaveType: { name: 'ลา' },
      employee: { ...emp, branchId: 'b1' },
    }),
    mapAdvanceCard({
      id: 'a1',
      amount: 100,
      requestedAt: new Date('2026-07-02'),
      employee: { ...emp, firstName: 'อา', nickname: null, branchId: 'b2' },
    }),
  ];
  it('filters by type', () => {
    expect(filterApprovalCards(cards, { type: 'advance' }).map((c) => c.id)).toEqual(['a1']);
  });
  it('filters by branchId', () => {
    expect(filterApprovalCards(cards, { branchId: 'b2' }).map((c) => c.id)).toEqual(['a1']);
  });
  it('filters by employee-name query (case-insensitive, matches name or nickname)', () => {
    expect(filterApprovalCards(cards, { q: 'หนึ่ง' }).map((c) => c.id)).toEqual(['l1']);
  });
  it('ignores blank filters', () => {
    expect(filterApprovalCards(cards, { type: '', branchId: '  ', q: '' })).toHaveLength(2);
  });
});

describe('sortApprovalCardsDesc', () => {
  it('sorts newest submittedAt first, interleaving types', () => {
    const a = mapAdvanceCard({
      id: 'a1',
      amount: 1,
      requestedAt: new Date('2026-07-05'),
      employee: { ...emp, branchId: 'b1' },
    });
    const l = mapLeaveCard({
      id: 'l1',
      createdAt: new Date('2026-07-09'),
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-10'),
      leaveType: { name: 'ลา' },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(sortApprovalCardsDesc([a, l]).map((c) => c.id)).toEqual(['l1', 'a1']);
  });
});

describe('waitingDays', () => {
  // Bangkok is UTC+7, so a UTC instant late in the day is already the next
  // calendar date locally. These fixtures are written as UTC on purpose.
  const bkk = (isoDate: string, hhmm = '00:00') => new Date(`${isoDate}T${hhmm}:00+07:00`);

  it('is 0 on the day of submission', () => {
    expect(waitingDays(bkk('2026-09-06', '09:00'), bkk('2026-09-06', '23:00'))).toBe(0);
  });

  it('counts calendar days, not 24-hour spans', () => {
    // Two hours apart, but across midnight — an admin reading the queue the
    // next morning is looking at yesterday's request.
    expect(waitingDays(bkk('2026-09-06', '23:00'), bkk('2026-09-07', '01:00'))).toBe(1);
  });

  it('counts the real gap between the two disputes this page could not tell apart', () => {
    expect(waitingDays(bkk('2026-06-22'), bkk('2026-07-31'))).toBe(39);
  });

  it('never returns a negative age for a future-dated row', () => {
    expect(waitingDays(bkk('2026-09-10'), bkk('2026-09-06'))).toBe(0);
  });

  it('uses the Bangkok calendar day, not the runtime timezone', () => {
    // 2026-09-06T18:30Z is already 2026-09-07 in Bangkok. Submitted then and
    // read at 2026-09-07T04:00Z (11:00 Bangkok, same local day) is 0 days —
    // a UTC-based implementation would say 1.
    const submitted = new Date('2026-09-06T18:30:00Z');
    const now = new Date('2026-09-07T04:00:00Z');
    expect(waitingDays(submitted, now)).toBe(0);
  });
});
