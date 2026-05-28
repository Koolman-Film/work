import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { calculateAdvanceBalance } from './balance';

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
  it("returns 'rate-based' shape without an 'available' figure for Daily", () => {
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
      // No `available` field — we don't claim to know.
      expect('available' in r).toBe(false);
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
