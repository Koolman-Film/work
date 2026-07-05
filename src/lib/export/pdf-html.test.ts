import { describe, expect, it } from 'vitest';
import type { ExportTable } from './export-table';
import { renderPdfHtml } from './pdf-html';

const table: ExportTable = {
  title: 'รายงานการมาทำงาน',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'จำนวน', align: 'right', format: 'thb' },
  ],
  rows: [{ name: '<script>alert(1)</script>', amount: 1500.5 }],
  totals: { name: 'รวม 1 คน', amount: 1500.5 },
};

describe('renderPdfHtml', () => {
  const html = renderPdfHtml(table, { regularB64: 'AAAA', boldB64: 'BBBB' });
  it('escapes HTML in cell values', () => {
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
  it('renders title, period, and THB-formatted cells', () => {
    expect(html).toContain('รายงานการมาทำงาน');
    expect(html).toContain('มิ.ย. 2569');
    expect(html).toContain('฿1,500.50');
  });
  it('embeds fonts and sapphire header styling', () => {
    expect(html).toContain('base64,AAAA');
    expect(html).toContain('#3955e8');
    expect(html).toContain('<thead>');
  });
});
