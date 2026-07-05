import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import type { ExportTable } from './export-table';

const table: ExportTable = {
  title: 'รายงานทดสอบ',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'จำนวน', format: 'thb' },
  ],
  rows: [
    { name: 'สมชาย "บิ๊ก", จูเนียร์', amount: 1234.5 },
    { name: 'สมหญิง\nสองบรรทัด', amount: 0 },
  ],
  totals: { name: 'รวม 2 คน', amount: 1234.5 },
};

describe('toCsv', () => {
  const csv = toCsv(table);
  it('starts with UTF-8 BOM so Excel decodes Thai', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it('quotes fields containing commas, quotes, newlines (RFC 4180)', () => {
    expect(csv).toContain('"สมชาย ""บิ๊ก"", จูเนียร์"');
    expect(csv).toContain('"สมหญิง\nสองบรรทัด"');
  });
  it('emits raw numbers without ฿ or separators', () => {
    expect(csv).toContain('1234.5');
    expect(csv).not.toContain('฿');
  });
  it('neutralizes formula-leading text cells but leaves numbers raw', () => {
    const csv2 = toCsv({
      ...table,
      rows: [{ name: '=HYPERLINK("http://evil")', amount: -5 }],
      totals: undefined,
    });
    expect(csv2).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv2).toContain('-5');
  });
  it('includes header row and totals row', () => {
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('พนักงาน,จำนวน');
    expect(lines.at(-1)).toBe('รวม 2 คน,1234.5');
  });
});
