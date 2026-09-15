import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { JournalEntry } from './payroll-journal';
import { buildPayrollJournalXlsx } from './payroll-journal-xlsx';

/**
 * The one thing about this file that cannot be checked by looking at it: the
 * date column and the memo use DIFFERENT calendars on purpose. A reader who
 * spots `2026` next to `2569` will reach for consistency, so the split is
 * asserted here rather than only explained in a comment.
 */

const entry: JournalEntry = {
  month: '2026-06',
  branchName: 'สำนักงานใหญ่',
  lines: [
    { kind: 'SalaryExpense', accountCode: '5100', accountName: 'เงินเดือน', amount: 100_00 },
    { kind: 'NetPayable', accountCode: '2100', accountName: 'เงินเดือนค้างจ่าย', amount: -100_00 },
  ],
  totalDebit: 100_00,
  totalCredit: 100_00,
};

async function firstDataRow() {
  const wb = new ExcelJS.Workbook();
  // ExcelJS declares `load(data: Buffer)` against an older @types/node, so a
  // modern `Buffer<ArrayBufferLike>` does not structurally match. The value is
  // the right thing at runtime; only the declaration is stale. Same cast as
  // sso-1-10-xlsx.test.ts.
  const buf = (await buildPayrollJournalXlsx(entry)) as unknown as Parameters<
    typeof wb.xlsx.load
  >[0];
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  expect(ws).toBeDefined();
  const row = ws?.getRow(2);
  return {
    date: String(row?.getCell(1).value ?? ''),
    memo: String(row?.getCell(7).value ?? ''),
  };
}

describe('payroll journal xlsx — calendar eras', () => {
  it('writes the date column in the Gregorian year, for the importer', async () => {
    const { date } = await firstDataRow();
    // Last day of June 2026, and 2026 — NOT 2569. An unmarked Buddhist year
    // here parses as a date five centuries out, silently.
    expect(date).toBe('30/06/2026');
  });

  it('writes the memo in the Buddhist year, for the person reading it', async () => {
    const { memo } = await firstDataRow();
    expect(memo).toContain('2569');
    expect(memo).not.toContain('2026');
  });

  it('has both describing the same month', async () => {
    const { date, memo } = await firstDataRow();
    const gregorian = Number(date.slice(-4));
    const buddhist = Number(memo.match(/\d{4}/)?.[0]);
    expect(buddhist - gregorian).toBe(543);
  });
});
