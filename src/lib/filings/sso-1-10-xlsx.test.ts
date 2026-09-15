import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { SsoFiling } from './sso';
import { buildSso110Xlsx } from './sso-1-10-xlsx';

/**
 * This workbook is UPLOADED to SSO e-Services, so its shape is a contract, not
 * a presentation choice. These tests pin the contract.
 *
 * The previous builder was written from the paper form and diverged from the
 * official upload template in four ways at once — an extra `ลำดับที่`, a
 * concatenated name, a missing `คำนำหน้าชื่อ`, and title/totals blocks the
 * template does not have. Nothing caught it because nothing asserted the shape.
 */

const filing = (over: Partial<SsoFiling> = {}): SsoFiling => ({
  month: '2026-09',
  branch: { id: 'b1', name: 'สำนักงานใหญ่', ssoAccountNo: '1234567890', ssoBranchNo: '000000' },
  rows: [
    {
      employeeId: 'e1',
      nationalId: '1234567890123',
      titlePrefixTh: 'นางสาว',
      firstName: 'นภา',
      lastName: 'ฟ้าใส',
      name: 'นภา ฟ้าใส',
      wages: 17000,
      employeeContribution: 850,
      employerContribution: 850,
    },
  ],
  totals: { wages: 17000, employee: 850, employer: 850, grand: 1700, count: 1 },
  ratePercent: 5,
  problems: {
    missingNationalIds: 0,
    missingTitlePrefixes: 0,
    missingBranchSso: false,
    missingBranchSsoNo: false,
  },
  ...over,
});

async function read(f: SsoFiling) {
  const wb = new ExcelJS.Workbook();
  // ExcelJS declares `load(data: Buffer)` against an older @types/node, so a
  // modern `Buffer<ArrayBufferLike>` does not structurally match. The value is
  // the right thing at runtime; only the declaration is stale.
  const buf = (await buildSso110Xlsx(f)) as unknown as Parameters<typeof wb.xlsx.load>[0];
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('no worksheet');
  const row = (n: number) => (ws.getRow(n).values as unknown[]).slice(1).map((v) => v ?? '');
  return { ws, row };
}

describe('สปส.1-10 upload workbook', () => {
  it('row 1 is the official header, in order, with no title block above it', async () => {
    const { row } = await read(filing());
    expect(row(1)).toEqual([
      'เลขประจำตัวประชาชน',
      'คำนำหน้าชื่อ',
      'ชื่อผู้ประกันตน',
      'นามสกุลผู้ประกันตน',
      'ค่าจ้าง',
      'จำนวนเงินสมทบ',
    ]);
  });

  it('names the worksheet for the SSO branch number, not the form', async () => {
    // "โปรดระบุชื่อ Sheet ให้ตรงกับลำดับที่สาขาที่สำนักงานประกันสังคมกำหนด"
    const { ws } = await read(filing());
    expect(ws.name).toBe('000000');
  });

  it('splits the name and writes the Thai title word, not a code', async () => {
    const { row } = await read(filing());
    expect(row(2)).toEqual(['1234567890123', 'นางสาว', 'นภา', 'ฟ้าใส', 17000, 850]);
  });

  it('writes the EMPLOYEE contribution, not the combined total', async () => {
    // The employer pays a matching amount, but สปส.1-10's per-person column is
    // the insured person's own contribution.
    const { row } = await read(filing());
    expect(row(2)[5]).toBe(850);
  });

  it('emits no totals block — the page shows those, the file must not', async () => {
    const { ws } = await read(filing());
    expect(ws.rowCount).toBe(2); // header + one person
  });

  it('sanitises a branch number Excel would reject as a sheet name', async () => {
    const f = filing();
    const { ws } = await read({
      ...f,
      branch: { ...f.branch, ssoBranchNo: '00/00*01' },
    });
    expect(ws.name).toBe('000001');
  });

  it('leaves a missing title prefix blank rather than inventing one', async () => {
    // The route refuses to reach here, but if it ever did, a blank cell is
    // recoverable and a guessed "นาย" is not.
    const f = filing();
    const rows = f.rows[0];
    if (!rows) throw new Error('fixture');
    const { row } = await read({ ...f, rows: [{ ...rows, titlePrefixTh: null }] });
    expect(row(2)[1]).toBe('');
  });
});
