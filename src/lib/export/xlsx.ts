/**
 * Excel writer — Sapphire Editorial styling: title block, sapphire-600
 * header band, frozen panes, per-column numFmt, gray totals row.
 * Returns a Buffer for the route to stream.
 */
import ExcelJS from 'exceljs';
import type { CellFormat, ExportTable } from './export-table';

const SAPPHIRE_600 = 'FF3955E8';
const GRAY_50 = 'FFF9FAFB';
const INK_1 = 'FF0F172A';
const FONT = 'IBM Plex Sans Thai';

const numFmtFor: Record<CellFormat, string | undefined> = {
  text: undefined,
  int: '#,##0',
  thb: '"฿"#,##0.00',
};

export async function toXlsx(table: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.title, {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colCount = table.columns.length;

  // Title block (rows 1–3)
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = table.title;
  titleCell.font = { name: FONT, size: 16, bold: true, color: { argb: INK_1 } };
  ws.mergeCells(2, 1, 2, colCount);
  const periodCell = ws.getCell(2, 1);
  periodCell.value = `ช่วงเวลา: ${table.periodLabel} • สร้างเมื่อ ${table.generatedAt}`;
  periodCell.font = { name: FONT, size: 10, color: { argb: 'FF64748B' } };
  ws.getRow(3).height = 6; // spacer

  // Header (row 4)
  const header = ws.getRow(4);
  table.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAPPHIRE_600 } };
    cell.alignment = { horizontal: c.align ?? 'left', vertical: 'middle' };
  });
  header.height = 22;

  // Data rows — explicit row index to guarantee row 5+ placement
  table.rows.forEach((row, idx) => {
    const r = ws.getRow(5 + idx);
    table.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = row[c.key] ?? '';
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { horizontal: c.align ?? 'left' };
      const fmt = numFmtFor[c.format ?? 'text'];
      if (fmt && typeof row[c.key] === 'number') cell.numFmt = fmt;
    });
  });

  // Totals row
  if (table.totals) {
    const totalsRowIdx = 5 + table.rows.length;
    const r = ws.getRow(totalsRowIdx);
    table.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = table.totals?.[c.key] ?? '';
      cell.font = { name: FONT, size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_50 } };
      cell.alignment = { horizontal: c.align ?? 'left' };
      const fmt = numFmtFor[c.format ?? 'text'];
      if (fmt && typeof table.totals?.[c.key] === 'number') cell.numFmt = fmt;
    });
  }

  // Auto widths from content length (capped 12–40 chars)
  table.columns.forEach((c, i) => {
    const lengths = [c.label.length, ...table.rows.map((r) => String(r[c.key] ?? '').length)];
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, Math.max(...lengths) + 4));
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
