import { Download } from 'lucide-react';
import Link from 'next/link';
import { loadReportFilterOptions } from '@/app/(admin)/admin/reports/_load-filter-options';
import { PageHeader } from '@/components/ui/page-header';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { loadSsoFiling } from '@/lib/filings/sso';
import { SsoFilters } from './sso-filters';

type SearchParams = Promise<{ m?: string; branchId?: string }>;

export default async function SsoFilingPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission('filing.read');
  const permitted = await getPermittedBranches(user, 'filing.read');
  const sp = await searchParams;

  const { branches } = await loadReportFilterOptions(permitted);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '')
    ? (sp.m as string)
    : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const branchId = sp.branchId && branches.some((b) => b.id === sp.branchId) ? sp.branchId : '';

  const filing = branchId ? await loadSsoFiling(month, branchId) : null;
  const canDownload =
    !!filing &&
    filing.rows.length > 0 &&
    filing.problems.missingNationalIds === 0 &&
    !filing.problems.missingBranchSso;
  const downloadHref = `/admin/filings/sso/export?m=${month}&branchId=${branchId}`;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ยื่นประกันสังคม"
        title="ยื่นประกันสังคม (สปส.1-10)"
        subtitle="ตรวจสอบข้อมูลนำส่งเงินสมทบรายเดือนก่อนดาวน์โหลดไฟล์ยื่นสำนักงานประกันสังคม"
      />
      <SsoFilters initial={{ m: month, branchId }} branches={branches} />

      {!branchId ? (
        <div className="surface p-8 text-center text-ink-4">เลือกสาขาเพื่อดูรายการนำส่ง</div>
      ) : !filing || filing.rows.length === 0 ? (
        <div className="surface p-8 text-center text-ink-4">
          ยังไม่มีข้อมูลเงินเดือนของสาขานี้ในเดือนที่เลือก
        </div>
      ) : (
        <>
          {(filing.problems.missingNationalIds > 0 || filing.problems.missingBranchSso) && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              {filing.problems.missingBranchSso && (
                <div>• สาขานี้ยังไม่ได้กรอกเลขที่บัญชีนายจ้าง (แก้ที่หน้าตั้งค่าสาขา)</div>
              )}
              {filing.problems.missingNationalIds > 0 && (
                <div>• มีพนักงาน {filing.problems.missingNationalIds} คนที่ยังไม่มีเลขประจำตัวประชาชน</div>
              )}
              <div className="mt-1 font-medium">กรอกข้อมูลให้ครบก่อนจึงจะดาวน์โหลดไฟล์ได้</div>
            </div>
          )}

          <div className="surface overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs text-ink-3">
                <tr>
                  <th className="px-3 py-2">ชื่อ-สกุล</th>
                  <th className="px-3 py-2">เลขประจำตัวประชาชน</th>
                  <th className="px-3 py-2 text-right">ค่าจ้าง</th>
                  <th className="px-3 py-2 text-right">เงินสมทบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {filing.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td className="px-3 py-2 text-ink-1">{r.name}</td>
                    <td className={`px-3 py-2 ${r.nationalId ? 'text-ink-2' : 'text-red-600'}`}>
                      {r.nationalId ?? 'ไม่มีข้อมูล'}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {r.wages.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {r.employeeContribution.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-muted font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    รวม {filing.totals.count} คน
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {filing.totals.wages.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {filing.totals.employee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4">
            {canDownload ? (
              <Link
                href={downloadHref}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                download
              >
                <Download size={16} /> ดาวน์โหลด Excel (สปส.1-10)
              </Link>
            ) : (
              <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-line px-4 py-2 text-sm font-medium text-ink-3">
                <Download size={16} /> ดาวน์โหลด Excel (สปส.1-10)
              </span>
            )}
            <p className="mt-2 text-xs text-ink-4">
              รูปแบบไฟล์อยู่ระหว่างตรวจสอบกับเทมเพลตจริงของ e-Service — โปรดตรวจทานก่อนนำส่ง
            </p>
          </div>
        </>
      )}
    </div>
  );
}
