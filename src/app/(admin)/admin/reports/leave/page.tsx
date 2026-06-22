import { Calendar } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatTHB2, formatThaiDate } from '@/lib/format';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours } from '@/lib/leave/units';
import { resolveReportPeriod } from '@/lib/reports/period';
import { leaveDetail, leaveReport } from '@/lib/reports/queries';
import { asUuid, loadReportFilterOptions } from '../_load-filter-options';
import { ExpandableReportRows } from '../expandable-report-rows';
import { PeriodPicker } from '../period-picker';
import { ReportFilters } from '../report-filters';

export default async function LeaveReportPage({
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
  const year = Number((period.month ?? period.from).slice(0, 4));
  const branchId = asUuid(params.branchId);
  const departmentId = asUuid(params.departmentId);
  const filter = { q: params.q, branchId, departmentId };
  const [{ types, rows }, detail, cfg, options] = await Promise.all([
    leaveReport(period, filter, year),
    leaveDetail(period, filter),
    getLeaveConfig(),
    loadReportFilterOptions(),
  ]);

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
          <EmptyState icon={<Calendar size={28} />} title="ไม่มีข้อมูลในช่วงนี้" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-6 px-2 py-2.5" />
                <th className="px-4 py-2.5">พนักงาน</th>
                {types.map((t) => (
                  <th key={t.id} className="px-4 py-2.5 text-right">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <ExpandableReportRows
                rows={rows.map((r) => {
                  const items = detail[r.employeeId] ?? [];
                  return {
                    id: r.employeeId,
                    colSpan: types.length + 2,
                    cells: (
                      <>
                        <td className="px-4 py-2.5 align-top">{r.name}</td>
                        {types.map((t) => {
                          const cell = r.byType[t.id];
                          const remaining = r.remainingByType[t.id];
                          return (
                            <td key={t.id} className="px-4 py-2.5 text-right align-top">
                              <div>{cell ? formatDaysHours(cell.usedMinutes, cfg) : '—'}</div>
                              <div className="text-xs text-gray-500">
                                คงเหลือ{' '}
                                {remaining === undefined || remaining === null
                                  ? 'ไม่จำกัด'
                                  : formatDaysHours(remaining, cfg)}
                              </div>
                              {cell && cell.overQuotaMinutes > 0 && (
                                <div className="text-xs font-medium text-amber-600">
                                  เกิน {formatDaysHours(cell.overQuotaMinutes, cfg)} (
                                  {formatTHB2(cell.deductAmount)})
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </>
                    ),
                    detail:
                      items.length === 0 ? null : (
                        <ul className="space-y-1 text-xs text-gray-600">
                          {items.map((it) => {
                            const range =
                              it.startDate.getTime() === it.endDate.getTime()
                                ? formatThaiDate(it.startDate)
                                : `${formatThaiDate(it.startDate)} – ${formatThaiDate(it.endDate)}`;
                            return (
                              <li key={it.id} className="flex items-center justify-between gap-4">
                                <span>
                                  {it.leaveTypeName} · {range}
                                </span>
                                <span className="text-gray-800">
                                  {formatDaysHours(it.chargedMinutes, cfg)}
                                  {it.overQuotaMinutes > 0 && (
                                    <span className="ml-1 text-amber-600">
                                      (เกิน {formatDaysHours(it.overQuotaMinutes, cfg)})
                                    </span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ),
                  };
                })}
              />
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-500">
        * &quot;ใช้ไป&quot; นับเฉพาะช่วงเวลาที่เลือก — &quot;คงเหลือ&quot; เป็นสิทธิคงเหลือของทั้งปี {year + 543}
      </p>
    </div>
  );
}
