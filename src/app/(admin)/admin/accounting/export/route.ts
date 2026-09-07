import { type NextRequest, NextResponse } from 'next/server';
import { JOURNAL_LINE_LABEL } from '@/lib/accounting/labels';
import { loadPayrollJournal } from '@/lib/accounting/load-payroll-journal';
import { buildPayrollJournalXlsx } from '@/lib/accounting/payroll-journal-xlsx';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';

export const runtime = 'nodejs';
export const maxDuration = 60;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const { user } = await requirePermission('accounting.export');
  const permitted = await getPermittedBranches(user, 'accounting.export');

  const sp = req.nextUrl.searchParams;
  const month = sp.get('m') ?? '';
  const branchId = sp.get('branchId') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month) || !UUID_RE.test(branchId)) {
    return NextResponse.json(
      { error: 'พารามิเตอร์ไม่ถูกต้อง (m=YYYY-MM, branchId=uuid)' },
      { status: 400 },
    );
  }
  if (permitted !== 'all' && !permitted.includes(branchId)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึงสาขานี้' }, { status: 403 });
  }

  const result = await loadPayrollJournal(month, branchId);

  // Same posture as the สปส.1-10 route: refuse rather than emit a file with a
  // hole in it. A journal that does not balance, or that posts to an account
  // nobody chose, is worse than no journal — it lands in someone's books.
  if (!result.ok) {
    if (result.reason === 'no-branch') {
      return NextResponse.json({ error: 'ไม่พบสาขา' }, { status: 404 });
    }
    const error =
      result.reason === 'no-payrolls'
        ? 'ไม่มีเงินเดือนที่ประกาศแล้วในเดือนนี้'
        : result.reason === 'unmapped'
          ? `ยังไม่ได้ผูกผังบัญชี: ${result.kinds
              .map((k) => JOURNAL_LINE_LABEL[k as keyof typeof JOURNAL_LINE_LABEL] ?? k)
              .join(', ')}`
          : `เดบิตและเครดิตไม่เท่ากัน ต่างกัน ${Math.abs(result.differenceSatang) / 100} บาท`;
    return NextResponse.json({ error }, { status: 422 });
  }

  const buf = await buildPayrollJournalXlsx(result.entry);
  const filename = `บัญชีเงินเดือน_${result.entry.branchName}_${month}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="payroll-journal.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
