import 'server-only';
import ExcelJS from 'exceljs';
import { monthLabelTh } from '@/lib/format';
import type { JournalEntry } from './payroll-journal';

const FONT = 'IBM Plex Sans Thai';

/**
 * บัญชีเงินเดือน — the payroll journal as a spreadsheet.
 *
 * The worksheet is named บัญชีเงินเดือน to match the page, rather than the
 * conventional accounting book name สมุดรายวันทั่วไป. A worksheet label naming
 * an ACTION ("ส่งออก…") would read as an instruction rather than content, so
 * the verb is dropped and the noun kept.
 *
 * XLSX rather than CSV on purpose: it sidesteps every Thai encoding problem at
 * once (no BOM question, no TIS-620 vs UTF-8), and it is the format Thai
 * accountants actually pass around. It is also the right answer for Express
 * users specifically — Express cannot import journal entries at all, so its
 * users need a file a person can read and key from, not a machine one.
 *
 * Columns follow the shape every target converged on — date, document number,
 * account, debit, credit, memo — so this doubles as the reference layout a
 * future PEAK/FlowAccount serialiser maps FROM.
 *
 * Debit and credit are separate columns here, derived from the signed amount.
 * That conversion belongs at the edge: internally one signed number cannot
 * disagree with itself, whereas two columns can both be filled in.
 */
const COLUMNS = [
  { label: 'วันที่', width: 14 },
  { label: 'เลขที่เอกสาร', width: 18 },
  { label: 'รหัสบัญชี', width: 14 },
  { label: 'ชื่อบัญชี', width: 28 },
  { label: 'เดบิต', width: 16 },
  { label: 'เครดิต', width: 16 },
  { label: 'คำอธิบาย', width: 36 },
];

const baht = (satang: number) => satang / 100;

/** Last calendar day of the payroll month — when payroll is booked. Built from
 *  the `YYYY-MM` string rather than a Date, so a server in any timezone
 *  produces the same document date. */
function postingDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(lastDay).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export async function buildPayrollJournalXlsx(entry: JournalEntry): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('บัญชีเงินเดือน');

  const docNo = `PAY-${entry.month}`;
  const date = postingDate(entry.month);
  const memo = `เงินเดือน ${monthLabelTh(entry.month)} — ${entry.branchName}`;

  const header = ws.getRow(1);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, size: 10, bold: true };
  });

  entry.lines.forEach((line, idx) => {
    const row = ws.getRow(2 + idx);
    const debit = line.amount > 0 ? baht(line.amount) : null;
    const credit = line.amount < 0 ? baht(-line.amount) : null;
    const values = [date, docNo, line.accountCode, line.accountName ?? '', debit, credit, memo];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: FONT, size: 10 };
      if (i === 4 || i === 5) cell.numFmt = '#,##0.00';
    });
  });

  // Totals. Present here, unlike the สปส.1-10 sheet, because a journal that
  // does not visibly balance is one an accountant will not trust — the two
  // figures being equal is the point of the document.
  const totalRow = ws.getRow(2 + entry.lines.length);
  totalRow.getCell(4).value = 'รวม';
  totalRow.getCell(5).value = baht(entry.totalDebit);
  totalRow.getCell(6).value = baht(entry.totalCredit);
  for (const i of [4, 5, 6]) {
    const cell = totalRow.getCell(i);
    cell.font = { name: FONT, size: 10, bold: true };
    if (i !== 4) cell.numFmt = '#,##0.00';
  }

  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
