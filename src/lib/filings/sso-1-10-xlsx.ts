import 'server-only';
import ExcelJS from 'exceljs';
import type { SsoFiling } from './sso';

const FONT = 'IBM Plex Sans Thai';

/**
 * สปส.1-10 upload workbook, matching SSO's official template exactly.
 *
 * This file is UPLOADED to e-Services (ส่งข้อมูลเงินสมทบ → แนบไฟล์), not read
 * by a person, so it is a machine artefact and every deviation is a risk. The
 * earlier version of this builder was written from the paper form and was
 * wrong in four ways: it added a `ลำดับที่` column, concatenated first and last
 * name into one `ชื่อ-สกุล`, omitted `คำนำหน้าชื่อ` entirely, and wrapped the
 * rows in a merged title block plus a totals summary. The official template has
 * none of that.
 *
 * The template is a SINGLE worksheet whose NAME is the SSO-assigned branch
 * number — the sample sheet is literally `000000`, carrying the note
 * "โปรดระบุชื่อ Sheet ให้ตรงกับลำดับที่สาขาที่สำนักงานประกันสังคมกำหนด".
 * Everything a human needs (employer account, month, totals) already renders on
 * /admin/filings/sso, so nothing is lost by leaving it out of the file.
 *
 * Header row, in order — do not reorder, rename, or add to it:
 *   เลขประจำตัวประชาชน | คำนำหน้าชื่อ | ชื่อผู้ประกันตน | นามสกุลผู้ประกันตน | ค่าจ้าง | จำนวนเงินสมทบ
 *
 * `คำนำหน้าชื่อ` is the Thai WORD here (นาย), not the 3-digit code the fixed-
 * width text format uses. Amounts are plain decimals, not ×100 integers.
 *
 * Still unverified: whether e-Services accepts this workbook as-is. The
 * portal's upload screen offers a `ประเภทไฟล์ข้อมูล` selector, so more than one
 * shape is accepted. The cheapest way to settle it is to re-download a genuine
 * accepted file from the transaction-status screen (rows filed by method `U`
 * carry a download icon) and diff it against this.
 */
const COLUMNS = [
  { key: 'nationalId', label: 'เลขประจำตัวประชาชน', width: 22 },
  { key: 'titlePrefix', label: 'คำนำหน้าชื่อ', width: 14 },
  { key: 'firstName', label: 'ชื่อผู้ประกันตน', width: 24 },
  { key: 'lastName', label: 'นามสกุลผู้ประกันตน', width: 24 },
  { key: 'wages', label: 'ค่าจ้าง', width: 16, numFmt: '#,##0.00' },
  { key: 'contribution', label: 'จำนวนเงินสมทบ', width: 18, numFmt: '#,##0.00' },
] as const satisfies ReadonlyArray<{
  key: keyof Row;
  label: string;
  width: number;
  numFmt?: string;
}>;

type Row = {
  nationalId: string;
  titlePrefix: string;
  firstName: string;
  lastName: string;
  wages: number;
  contribution: number;
};

/** Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 chars. The
 *  branch number is digits in practice, but it is admin-entered free text, so
 *  sanitise rather than let `addWorksheet` throw at download time. */
function sheetName(ssoBranchNo: string): string {
  return ssoBranchNo.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || '000000';
}

export async function buildSso110Xlsx(filing: SsoFiling): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // The route refuses to call this while ssoBranchNo is missing; the fallback
  // exists so a bug there cannot produce a workbook with no sheet at all.
  const ws = wb.addWorksheet(sheetName(filing.branch.ssoBranchNo ?? '000000'));

  // Row 1 IS the header. No title block above it.
  const header = ws.getRow(1);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, size: 10, bold: true };
  });

  filing.rows.forEach((r, idx) => {
    const excelRow = ws.getRow(2 + idx);
    const values: Row = {
      nationalId: r.nationalId ?? '',
      titlePrefix: r.titlePrefixTh ?? '',
      firstName: r.firstName,
      lastName: r.lastName,
      wages: r.wages,
      contribution: r.employeeContribution,
    };
    COLUMNS.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = values[c.key];
      cell.font = { name: FONT, size: 10 };
      if ('numFmt' in c && c.numFmt && typeof values[c.key] === 'number') cell.numFmt = c.numFmt;
    });
  });

  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
