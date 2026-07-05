/**
 * GET /admin/reports/(attendance|leave|advance)/export?format=pdf|xlsx|csv&m=&from=&to=&q=&branchId=&departmentId=
 * Permission-gated download endpoint. Reuses the page query layer — including
 * branch-scope enforcement — so the file always matches what's on screen for
 * the same params, and never leaks rows outside the caller's permitted branches.
 */
import { notFound } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { toCsv } from '@/lib/export/csv';
import { type ExportTable, exportFilename } from '@/lib/export/export-table';
import { advanceTable, attendanceTable, leaveTable } from '@/lib/export/mappers';
import { toPdf } from '@/lib/export/pdf';
import { toXlsx } from '@/lib/export/xlsx';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceReport, attendanceReport, leaveReport } from '@/lib/reports/queries';
import { asUuid, loadPayrollCutoffDay } from '../../_load-filter-options';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FORMATS = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;
type Format = keyof typeof FORMATS;

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { user } = await requirePermission('report.read');
  const permitted = await getPermittedBranches(user, 'report.read');

  const { report } = await params;
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') as Format | null;
  if (!format || !(format in FORMATS)) {
    return NextResponse.json({ error: 'รูปแบบไฟล์ไม่ถูกต้อง (format=pdf|xlsx|csv)' }, { status: 400 });
  }

  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(
    {
      m: sp.get('m') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
    },
    todayYmd,
    await loadPayrollCutoffDay(),
  );
  const filter = {
    q: sp.get('q') ?? undefined,
    branchId: asUuid(sp.get('branchId') ?? undefined),
    departmentId: asUuid(sp.get('departmentId') ?? undefined),
  };

  let table: ExportTable;
  if (report === 'attendance') {
    table = attendanceTable(await attendanceReport(period, filter, permitted), period);
  } else if (report === 'advance') {
    table = advanceTable(await advanceReport(period, filter, permitted), period);
  } else if (report === 'leave') {
    const year = Number((period.month ?? period.from).slice(0, 4));
    const [{ types, rows }, cfg] = await Promise.all([
      leaveReport(period, filter, year, permitted),
      getLeaveConfig(),
    ]);
    table = leaveTable(rows, types, cfg, period, year);
  } else {
    return notFound();
  }

  const filename = exportFilename(table.title, period, format);
  const headers = {
    'Content-Type': FORMATS[format],
    // RFC 5987 filename* for the Thai name; plain ASCII fallback first.
    'Content-Disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  };

  try {
    if (format === 'csv') return new NextResponse(toCsv(table), { headers });
    if (format === 'xlsx')
      return new NextResponse(new Uint8Array(await toXlsx(table)), { headers });
    return new NextResponse(new Uint8Array(await toPdf(table)), { headers });
  } catch (err) {
    console.error('[export] report export failed', { err, report, format });
    return NextResponse.json({ error: 'สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
