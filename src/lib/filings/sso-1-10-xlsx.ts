import 'server-only';
import ExcelJS from 'exceljs';
import { monthLabelTh } from '@/lib/format';
import type { SsoFiling } from './sso';

const FONT = 'IBM Plex Sans Thai';
const HEADER_FILL = 'FF3955E8';
const GRAY_50 = 'FFF9FAFB';

/**
 * สปส.1-10 (ส่วนที่ 2) detail columns.
 * ⚠️ VERIFY BEFORE SHIP: reconcile the order/headers against a downloaded real
 * SSO e-Service upload template — a wrong column order/label makes the portal
 * reject the file. Keep all column changes confined to this constant.
 */
const COLUMNS: { key: keyof Row; label: string; width: number; numFmt?: string }[] = [
  { key: 'seq', label: 'ลำดับที่', width: 8 },
  { key: 'nationalId', label: 'เลขประจำตัวประชาชน', width: 22 },
  { key: 'name', label: 'ชื่อ-สกุล', width: 30 },
  { key: 'wages', label: 'ค่าจ้าง', width: 16, numFmt: '#,##0.00' },
  { key: 'contribution', label: 'เงินสมทบ', width: 16, numFmt: '#,##0.00' },
];

type Row = { seq: number; nationalId: string; name: string; wages: number; contribution: number };

export async function buildSso110Xlsx(filing: SsoFiling): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('สปส.1-10');
  const colCount = COLUMNS.length;

  // Employer header block
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = 'แบบรายการแสดงการส่งเงินสมทบ (สปส.1-10)';
  title.font = { name: FONT, size: 14, bold: true };

  ws.getCell(2, 1).value = `สาขา: ${filing.branch.name}`;
  ws.getCell(3, 1).value = `เลขที่บัญชีนายจ้าง: ${filing.branch.ssoAccountNo ?? '—'}`;
  ws.getCell(4, 1).value = `ประจำเดือน: ${monthLabelTh(filing.month)}`;
  for (const r of [2, 3, 4]) ws.getCell(r, 1).font = { name: FONT, size: 10 };

  // Detail header (row 6)
  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  header.height = 20;

  // Detail rows
  filing.rows.forEach((r, idx) => {
    const excelRow = ws.getRow(headerRowIdx + 1 + idx);
    const values: Row = {
      seq: idx + 1,
      nationalId: r.nationalId ?? '',
      name: r.name,
      wages: r.wages,
      contribution: r.employeeContribution,
    };
    COLUMNS.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = values[c.key];
      cell.font = { name: FONT, size: 10 };
      if (c.numFmt && typeof values[c.key] === 'number') cell.numFmt = c.numFmt;
    });
  });

  // Summary block
  const sumStart = headerRowIdx + 1 + filing.rows.length + 1;
  const summary: [string, number][] = [
    ['จำนวนผู้ประกันตน (คน)', filing.totals.count],
    ['รวมค่าจ้าง', filing.totals.wages],
    ['เงินสมทบผู้ประกันตน', filing.totals.employee],
    ['เงินสมทบนายจ้าง', filing.totals.employer],
    ['รวมนำส่งทั้งสิ้น', filing.totals.grand],
  ];
  summary.forEach(([label, val], i) => {
    const r = ws.getRow(sumStart + i);
    const labelCell = r.getCell(colCount - 1);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 10, bold: true };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_50 } };
    const valCell = r.getCell(colCount);
    valCell.value = val;
    valCell.font = { name: FONT, size: 10, bold: true };
    if (label !== 'จำนวนผู้ประกันตน (คน)') valCell.numFmt = '#,##0.00';
  });

  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
