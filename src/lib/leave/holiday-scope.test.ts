import { describe, expect, it } from 'vitest';
import {
  holidayAppliesToBranch,
  holidayDatesForBranch,
  holidayYmdLookup,
  isCompanyHoliday,
  type ScopedHoliday,
} from './holiday-scope';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymds = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10)).sort();

const holidays: ScopedHoliday[] = [
  { date: d('2026-12-05'), branchIds: [] }, // Sat — company
  { date: d('2026-12-06'), branchIds: [] }, // Sun — company → Mon 7 substitute
  { date: d('2026-12-31'), branchIds: ['lampang'] }, // Thu — Lampang closed
  { date: d('2026-12-27'), branchIds: ['lampang', 'lamphun'] }, // Sun — closure, no substitute
];

describe('holiday scope', () => {
  it('an empty branch list is a company holiday for every branch', () => {
    expect(isCompanyHoliday(holidays[0] as ScopedHoliday)).toBe(true);
    expect(holidayAppliesToBranch(holidays[0] as ScopedHoliday, 'anything')).toBe(true);
  });

  it('a branch closure applies to the listed branches only', () => {
    const closure = holidays[2] as ScopedHoliday;
    expect(holidayAppliesToBranch(closure, 'lampang')).toBe(true);
    expect(holidayAppliesToBranch(closure, 'chiangmai')).toBe(false);
  });

  it('open branches get company holidays and their substitutes, no closures', () => {
    expect(ymds(holidayDatesForBranch(holidays, 'chiangmai'))).toEqual([
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
    ]);
  });

  it('a closed branch also gets its closures — a Sunday closure gives no Monday', () => {
    expect(ymds(holidayDatesForBranch(holidays, 'lampang'))).toEqual([
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
      '2026-12-27',
      '2026-12-31',
    ]);
    expect(ymds(holidayDatesForBranch(holidays, 'lamphun'))).toContain('2026-12-27');
    expect(ymds(holidayDatesForBranch(holidays, 'lamphun'))).not.toContain('2026-12-28');
  });

  it('a closure on a company-holiday date is not counted twice', () => {
    const both: ScopedHoliday[] = [
      { date: d('2026-12-05'), branchIds: [] },
      { date: d('2026-12-05'), branchIds: ['lampang'] },
    ];
    expect(ymds(holidayDatesForBranch(both, 'lampang'))).toEqual(['2026-12-05']);
  });

  it('the lookup memoises per branch and matches holidayDatesForBranch', () => {
    const forBranch = holidayYmdLookup(holidays);
    expect(forBranch('lampang')).toBe(forBranch('lampang'));
    expect(forBranch('lampang').has('2026-12-31')).toBe(true);
    expect(forBranch('chiangmai').has('2026-12-31')).toBe(false);
  });
});
