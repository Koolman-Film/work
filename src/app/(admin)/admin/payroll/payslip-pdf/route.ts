import { type NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit/log';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { payrollIdFor } from '@/lib/payroll/payroll-id';
import { buildPayslipRenderClosure } from '@/lib/payslip/render-closure';
import { getOrRenderPayslipPdf } from '@/lib/payslip/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  // Payroll permissions are global-only (see payroll-gates guardrail): a
  // global payroll admin may download any employee's slip — no branch scope.
  const { user } = await requireGlobalPermission('payroll.read');
  const sp = req.nextUrl.searchParams;
  const month = sp.get('m') ?? '';
  const employeeId = sp.get('employeeId') ?? '';
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) {
    return new NextResponse('Bad params', { status: 400 });
  }

  // No frozen slip (incl. unknown employee) → closure is null → 404.
  const rc = await buildPayslipRenderClosure(employeeId, month);
  if (!rc) return new NextResponse('Not found', { status: 404 });

  try {
    const { signedUrl, fromCache } = await getOrRenderPayslipPdf({
      employeeId,
      month,
      render: rc.render,
    });
    // entityId must be the Payroll row's UUID (AuditLog.entityId is @db.Uuid).
    // The employee + month that used to be crammed into it live in metadata.
    const payrollId = await payrollIdFor(employeeId, month);
    if (payrollId) {
      auditLog({
        actorId: user.id,
        action: 'payslip.download',
        entityType: 'Payroll',
        entityId: payrollId,
        metadata: { source: 'admin-ui', month, employeeId, fromCache },
      });
    }
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('[admin payslip-pdf] failed', { employeeId, month, err });
    return new NextResponse('Could not generate payslip', { status: 500 });
  }
}
