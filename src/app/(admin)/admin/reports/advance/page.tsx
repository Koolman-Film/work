import { Banknote } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatTHB2 } from '@/lib/format';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceReport } from '@/lib/reports/queries';
import { asUuid, loadReportFilterOptions } from '../_load-filter-options';
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
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd);
  const branchId = asUuid(params.branchId);
  const departmentId = asUuid(params.departmentId);
  const [rows, options] = await Promise.all([
    advanceReport(period, { q: params.q, branchId, departmentId }),
    loadReportFilterOptions(),
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
                <th className="px-4 py-2.5">พนักงาน</th>
                <th className="px-4 py-2.5 text-right">เบิกอนุมัติในช่วง</th>
                <th className="px-4 py-2.5 text-right">ค้างหัก</th>
                <th className="px-4 py-2.5 text-right">วงเงินคงเหลือ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">{r.name}</td>
                  <td className="px-4 py-2.5 text-right">{formatTHB2(r.approvedInPeriod)}</td>
                  <td className="px-4 py-2.5 text-right">{formatTHB2(r.outstandingNow)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.availableNow == null ? '—' : formatTHB2(r.availableNow)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-medium">
              <tr>
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
