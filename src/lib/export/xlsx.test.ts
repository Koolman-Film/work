import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportTable } from './export-table';
import { toXlsx } from './xlsx';

const table: ExportTable = {
  title: 'รายงานการเบิกเงิน',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'เบิกอนุมัติในช่วง', align: 'right', format: 'thb' },
    { key: 'count', label: 'ครั้ง', align: 'right', format: 'int' },
  ],
  rows: [{ name: 'สมชาย', amount: 1500.5, count: 3 }],
  totals: { name: 'รวม 1 คน', amount: 1500.5 },
};

async function roundTrip(t: ExportTable) {
  const buf = await toXlsx(t);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb.worksheets[0]!;
}

describe('toXlsx', () => {
  it('lays out title block, header, data, totals', async () => {
    const ws = await roundTrip(table);
    expect(ws.getCell('A1').value).toBe('รายงานการเบิกเงิน');
    expect(ws.getCell('A2').value).toContain('มิ.ย. 2569');
    expect(ws.getCell('A4').value).toBe('พนักงาน');
    expect(ws.getCell('A5').value).toBe('สมชาย');
    expect(ws.getCell('B5').value).toBe(1500.5); // real number, not string
    expect(ws.getCell('A6').value).toBe('รวม 1 คน');
  });
  it('applies THB and int number formats', async () => {
    const ws = await roundTrip(table);
    expect(ws.getCell('B5').numFmt).toBe('"฿"#,##0.00');
    expect(ws.getCell('C5').numFmt).toBe('#,##0');
  });
  it('styles header row with sapphire fill and freezes panes below it', async () => {
    const ws = await roundTrip(table);
    const fill = ws.getCell('A4').fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe('FF3955E8');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
  });
});
