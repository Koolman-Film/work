import { Banknote } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { formatTHB2, formatThaiDate } from '@/lib/format';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceDetail, advanceReport } from '@/lib/reports/queries';
import { asUuid, loadPayrollCutoffDay, loadReportFilterOptions } from '../_load-filter-options';
import { ExpandableReportRows } from '../expandable-report-rows';
import { PeriodPicker } from '../period-picker';
import { ReportFilters } from '../report-filters';

export default async function AdvanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    m?: string;
    from?: string;
    to?: string;
    q?: string;
    branchId?: string;
    departmentId?: string;
  }>;
}) {
  const params = await searchParams;
  const { user } = await requirePermission('report.read');
  const permitted = await getPermittedBranches(user, 'report.read');
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd, await loadPayrollCutoffDay());
  const branchId = asUuid(params.branchId);
  const departmentId = asUuid(params.departmentId);
  const filter = { q: params.q, branchId, departmentId };
  const [rows, detail, options] = await Promise.all([
    advanceReport(period, filter, permitted),
    advanceDetail(period, filter, permitted),
    loadReportFilterOptions(permitted),
  ]);

  const totals = rows.reduce(
    (a, r) => ({
      approvedInPeriod: a.approvedInPeriod + r.approvedInPeriod,
      outstandingNow: a.outstandingNow + r.outstandingNow,
    }),
    { approvedInPeriod: 0, outstandingNow: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker month={period.month} from={period.from} to={period.to} />
        <ReportFilters
          period={{ m: params.m, from: params.from, to: params.to }}
          branchId={branchId ?? ''}
          departmentId={departmentId ?? ''}
          q={params.q ?? ''}
          branches={options.branches}
          departments={options.departments}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <EmptyState icon={<Banknote size={28} />} title="ไม่มีข้อมูลในช่วงนี้" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-6 px-2 py-2.5" />
                <th className="px-4 py-2.5">พนักงาน</th>
                <th className="px-4 py-2.5 text-right">เบิกอนุมัติในช่วง</th>
                <th className="px-4 py-2.5 text-right">ค้างหัก</th>
                <th className="px-4 py-2.5 text-right">วงเงินคงเหลือ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <ExpandableReportRows
                rows={rows.map((r) => {
                  const items = detail[r.employeeId] ?? [];
                  return {
                    id: r.employeeId,
                    colSpan: 5,
                    cells: (
                      <>
                        <td className="px-4 py-2.5">{r.name}</td>
                        <td className="px-4 py-2.5 text-right">{formatTHB2(r.approvedInPeriod)}</td>
                        <td className="px-4 py-2.5 text-right">{formatTHB2(r.outstandingNow)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {r.availableNow == null ? '—' : formatTHB2(r.availableNow)}
                        </td>
                      </>
                    ),
                    detail:
                      items.length === 0 ? null : (
                        <ul className="space-y-1 text-xs text-gray-600">
                          {items.map((it) => (
                            <li key={it.id} className="flex items-center justify-between gap-4">
                              <span>
                                {it.approvedAt ? formatThaiDate(it.approvedAt) : '—'}
                                {it.isDeducted ? ' • หักแล้ว' : ' • ค้างหัก'}
                              </span>
                              <span className="font-medium text-gray-800">
                                {formatTHB2(it.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ),
                  };
                })}
              />
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-medium">
              <tr>
                <td />
                <td className="px-4 py-2.5">รวม {rows.length} คน</td>
                <td className="px-4 py-2.5 text-right">{formatTHB2(totals.approvedInPeriod)}</td>
                <td className="px-4 py-2.5 text-right">{formatTHB2(totals.outstandingNow)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
