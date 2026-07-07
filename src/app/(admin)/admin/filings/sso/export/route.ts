import { type NextRequest, NextResponse } from 'next/server';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { loadSsoFiling } from '@/lib/filings/sso';
import { buildSso110Xlsx } from '@/lib/filings/sso-1-10-xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function GET(req: NextRequest) {
  const { user } = await requirePermission('filing.export');
  const permitted = await getPermittedBranches(user, 'filing.export');

  const sp = req.nextUrl.searchParams;
  const month = sp.get('m') ?? '';
  const branchId = sp.get('branchId') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month) || !branchId) {
    return NextResponse.json({ error: 'พารามิเตอร์ไม่ถูกต้อง (m=YYYY-MM, branchId)' }, { status: 400 });
  }
  if (permitted !== 'all' && !permitted.includes(branchId)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึงสาขานี้' }, { status: 403 });
  }

  const filing = await loadSsoFiling(month, branchId);
  if (!filing) return NextResponse.json({ error: 'ไม่พบสาขา' }, { status: 404 });
  if (filing.problems.missingNationalIds > 0 || filing.problems.missingBranchSso) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ครบ — กรุณากรอกเลขประจำตัวประชาชน/เลขที่บัญชีนายจ้างให้ครบก่อนดาวน์โหลด' },
      { status: 422 },
    );
  }

  try {
    const buf = await buildSso110Xlsx(filing);
    const filename = `สปส1-10_${filing.branch.name}_${month}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="sso-1-10.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[filings] sso export failed', { err, month, branchId });
    return NextResponse.json({ error: 'สร้างไฟล์ไม่สำเร็จ' }, { status: 500 });
  }
}
