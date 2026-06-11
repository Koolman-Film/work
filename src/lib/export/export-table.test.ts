import { describe, expect, it } from 'vitest';
import { exportFilename, formatCellDisplay, thaiPeriodLabel } from './export-table';

describe('thaiPeriodLabel', () => {
  it('renders month mode with Buddhist year', () => {
    expect(thaiPeriodLabel({ from: '2026-06-01', to: '2026-06-30', month: '2026-06' })).toBe(
      'มิ.ย. 2569',
    );
  });
  it('renders custom range with Buddhist-era dates', () => {
    expect(thaiPeriodLabel({ from: '2026-06-01', to: '2026-06-15', month: null })).toBe(
      '1 มิ.ย. 2569 – 15 มิ.ย. 2569',
    );
  });
});

describe('exportFilename', () => {
  it('uses month in month mode', () => {
    expect(
      exportFilename(
        'รายงานการมาทำงาน',
        { from: '2026-06-01', to: '2026-06-30', month: '2026-06' },
        'xlsx',
      ),
    ).toBe('รายงานการมาทำงาน-2026-06.xlsx');
  });
  it('uses from_to in range mode', () => {
    expect(
      exportFilename('รายงานวันลา', { from: '2026-06-01', to: '2026-06-15', month: null }, 'csv'),
    ).toBe('รายงานวันลา-2026-06-01_2026-06-15.csv');
  });
});

describe('formatCellDisplay', () => {
  it('formats thb with 2 decimals', () => {
    expect(formatCellDisplay(5000, 'thb')).toBe('฿5,000.00');
  });
  it('formats ints with thousands separators', () => {
    expect(formatCellDisplay(1234, 'int')).toBe('1,234');
  });
  it('passes text through', () => {
    expect(formatCellDisplay('สมชาย', 'text')).toBe('สมชาย');
  });
});
