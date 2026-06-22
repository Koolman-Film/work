import { describe, expect, it } from 'vitest';
import { deductionBreakdown, deductionBreakdownLabel } from './deduction-breakdown';

const zero = { advance: 0, attendance: 0, leave: 0, debt: 0, other: 0 };

describe('deductionBreakdown', () => {
  it('returns only non-zero buckets, in display order', () => {
    // The แม็ก case: advance 9200 + attendance 500.
    const lines = deductionBreakdown({ ...zero, advance: 9200, attendance: 500 });
    expect(lines).toEqual([
      { label: 'เบิก', amount: 9200 },
      { label: 'ขาด/สาย', amount: 500 },
    ]);
  });

  it('is empty when nothing is deducted', () => {
    expect(deductionBreakdown(zero)).toEqual([]);
  });

  it('keeps the fixed bucket order regardless of amounts', () => {
    const lines = deductionBreakdown({ advance: 1, attendance: 2, leave: 3, debt: 4, other: 5 });
    expect(lines.map((l) => l.label)).toEqual(['เบิก', 'ขาด/สาย', 'ลา', 'ผ่อน/หนี้', 'อื่นๆ']);
  });
});

describe('deductionBreakdownLabel', () => {
  it('formats a compact thousands-separated line', () => {
    const lines = deductionBreakdown({ ...zero, advance: 9200, attendance: 500 });
    expect(deductionBreakdownLabel(lines)).toBe('เบิก 9,200 · ขาด/สาย 500');
  });
});
