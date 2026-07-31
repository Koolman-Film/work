import JSZip from 'jszip';
import { type NextRequest, NextResponse } from 'next/server';
import { auditLogMany } from '@/lib/audit/log';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { loadMonthPayslipTargets } from '@/lib/payslip/history';
import { buildPayslipRenderClosure } from '@/lib/payslip/render-closure';
import { getPayslipPdfBytes } from '@/lib/payslip/storage';
import { payslipZipEntryName } from '@/lib/payslip/zip-name';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest): Promise<Response> {
  // Payroll permissions are global-only (see payroll-gates guardrail): a
  // global payroll admin gets every branch's slips for the month — pass 'all'.
  const { user } = await requireGlobalPermission('payroll.read');
  const month = req.nextUrl.searchParams.get('m') ?? '';
  if (!MONTH_RE.test(month)) return new NextResponse('Bad month', { status: 400 });

  const targets = await loadMonthPayslipTargets(month, 'all');
  if (targets.length === 0) return new NextResponse('No payslips', { status: 404 });

  try {
    const zip = new JSZip();
    const seen = new Set<string>();
    const included: { payrollId: string; employeeId: string }[] = [];
    for (const target of targets) {
      const rc = await buildPayslipRenderClosure(target.employeeId, month);
      if (!rc) continue; // frozen slip vanished between select and render
      const bytes = await getPayslipPdfBytes({
        employeeId: target.employeeId,
        month,
        render: rc.render,
      });
      zip.file(payslipZipEntryName(target.name, month, seen), bytes);
      included.push({ payrollId: target.payrollId, employeeId: target.employeeId });
    }
    const count = included.length;
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    // One audit row per payslip actually in the ZIP, not one summary row. A ZIP
    // of N slips is N separate reads of N employees' salary documents, and the
    // trail has to answer "who read WHOSE payslip" — a single row cannot, and
    // had no real entity to point at (it used `bulk:<month>`, which is not a
    // UUID, so AuditLog.entityId rejected it and the write was dropped).
    auditLogMany(
      included.map((p) => ({
        actorId: user.id,
        action: 'payslip.download' as const,
        entityType: 'Payroll' as const,
        entityId: p.payrollId,
        metadata: {
          source: 'admin-ui-bulk',
          month,
          employeeId: p.employeeId,
          zipCount: count,
        },
      })),
    );

    const filename = `สลิปเงินเดือน_${month}.zip`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="payslips-${month}.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[admin payslips-zip] failed', { month, err });
    return new NextResponse('Could not build zip', { status: 500 });
  }
}
