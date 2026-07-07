import { type NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { buildPayslipRenderClosure } from '@/lib/payslip/render-closure';
import { getOrRenderPayslipPdf } from '@/lib/payslip/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const { user } = await requirePermission('payroll.read');
  const sp = req.nextUrl.searchParams;
  const month = sp.get('m') ?? '';
  const employeeId = sp.get('employeeId') ?? '';
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) {
    return new NextResponse('Bad params', { status: 400 });
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp) return new NextResponse('Not found', { status: 404 });
  const permitted = await getPermittedBranches(user, 'payroll.read');
  if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rc = await buildPayslipRenderClosure(employeeId, month);
  if (!rc) return new NextResponse('Not found', { status: 404 });

  try {
    const { signedUrl, fromCache } = await getOrRenderPayslipPdf({
      employeeId,
      month,
      render: rc.render,
    });
    auditLog({
      actorId: user.id,
      action: 'payslip.download',
      entityType: 'Payroll',
      entityId: `${employeeId}:${month}`,
      metadata: { source: 'admin-ui', month, fromCache },
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('[admin payslip-pdf] failed', { employeeId, month, err });
    return new NextResponse('Could not generate payslip', { status: 500 });
  }
}
