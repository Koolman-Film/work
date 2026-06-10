import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { calculateAdvanceBalance, isOverCap } from './balance';

describe('calculateAdvanceBalance — Monthly', () => {
  it('treats baseSalary as the available cap when there are no reserved advances', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 15_000,
      salaryType: 'Monthly',
      reservedAdvances: [],
    });
    expect(r.kind).toBe('monthly');
    if (r.kind === 'monthly') {
      expect(r.available).toBe(15_000);
      expect(r.reserved).toBe(0);
      expect(r.overdrawn).toBe(false);
    }
  });

  it('subtracts both Pending and Approved-not-deducted advances', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 15_000,
      salaryType: 'Monthly',
      reservedAdvances: [
        { status: 'Pending', amount: 1_000 },
        { status: 'Pending', amount: 500 },
        { status: 'Approved', amount: 2_000 },
      ],
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.pending).toBe(1_500);
    expect(r.approvedNotDeducted).toBe(2_000);
    expect(r.reserved).toBe(3_500);
    expect(r.available).toBe(11_500);
  });

  it('flags overdrawn when reserved exceeds baseSalary', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 15_000,
      salaryType: 'Monthly',
      reservedAdvances: [
        { status: 'Approved', amount: 12_000 },
        { status: 'Pending', amount: 5_000 }, // admin over-approved or employee submitted too much
      ],
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(-2_000);
    expect(r.overdrawn).toBe(true);
  });

  it('handles Prisma.Decimal amounts (real DB shape)', () => {
    const r = calculateAdvanceBalance({
      baseSalary: new Prisma.Decimal('15000.00'),
      salaryType: 'Monthly',
      reservedAdvances: [
        { status: 'Approved', amount: new Prisma.Decimal('2500.50') },
        { status: 'Pending', amount: new Prisma.Decimal('1000.25') },
      ],
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.reserved).toBeCloseTo(3500.75, 2);
    expect(r.available).toBeCloseTo(11499.25, 2);
  });

  it('handles string amounts (Decimal serialized as JSON)', () => {
    const r = calculateAdvanceBalance({
      baseSalary: '15000',
      salaryType: 'Monthly',
      reservedAdvances: [{ status: 'Approved', amount: '2000' }],
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(13_000);
  });

  it('ignores non-finite amounts (defensive)', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 15_000,
      salaryType: 'Monthly',
      reservedAdvances: [
        { status: 'Approved', amount: 2_000 },
        { status: 'Pending', amount: Number.NaN }, // shouldn't crash
        { status: 'Pending', amount: 'not-a-number' },
      ],
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.reserved).toBe(2_000);
    expect(r.available).toBe(13_000);
  });
});

describe('calculateAdvanceBalance — Daily / Hourly', () => {
  it("returns 'rate-based' shape with available=null when periodEarnings not supplied", () => {
    const r = calculateAdvanceBalance({
      baseSalary: 500,
      salaryType: 'Daily',
      reservedAdvances: [{ status: 'Approved', amount: 200 }],
    });
    expect(r.kind).toBe('rate-based');
    if (r.kind === 'rate-based') {
      expect(r.salaryType).toBe('Daily');
      expect(r.ratePerPeriod).toBe(500);
      expect(r.reserved).toBe(200);
      // available is null — we don't know earnings without periodEarnings
      expect(r.available).toBeNull();
      expect(r.overdrawn).toBe(false);
    }
  });

  it("returns 'rate-based' shape for Hourly too", () => {
    const r = calculateAdvanceBalance({
      baseSalary: 75,
      salaryType: 'Hourly',
      reservedAdvances: [],
    });
    if (r.kind !== 'rate-based') throw new Error('expected rate-based');
    expect(r.salaryType).toBe('Hourly');
    expect(r.ratePerPeriod).toBe(75);
    expect(r.pending).toBe(0);
    expect(r.approvedNotDeducted).toBe(0);
  });
});

describe('isOverCap', () => {
  it('returns true when amount exceeds available', () => {
    expect(isOverCap(5_000, 4_000)).toBe(true);
  });

  it('returns false when amount equals available (not over)', () => {
    expect(isOverCap(4_000, 4_000)).toBe(false);
  });

  it('returns false when available is null (rate-based uncomputable earnings)', () => {
    expect(isOverCap(5_000, null)).toBe(false);
  });
});

describe('calculateAdvanceBalance rate-based availability', () => {
  it('with periodEarnings: available = earnings − reserved', () => {
    const b = calculateAdvanceBalance({
      baseSalary: 400,
      salaryType: 'Daily',
      reservedAdvances: [{ status: 'Pending', amount: 1000 }],
      periodEarnings: 4000,
    });
    expect(b.kind).toBe('rate-based');
    if (b.kind === 'rate-based') {
      expect(b.available).toBe(3000);
      expect(b.overdrawn).toBe(false);
    }
  });
  it('without periodEarnings: available is null (V1 behavior preserved)', () => {
    const b = calculateAdvanceBalance({
      baseSalary: 400,
      salaryType: 'Hourly',
      reservedAdvances: [],
    });
    if (b.kind === 'rate-based') expect(b.available).toBeNull();
  });
});
