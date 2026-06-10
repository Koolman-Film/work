import { Calendar } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours } from '@/lib/leave/units';
import { resolveReportPeriod } from '@/lib/reports/period';
import { leaveReport } from '@/lib/reports/queries';
import { NameSearch } from '../name-search';
import { PeriodPicker } from '../period-picker';

const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;

export default async function LeaveReportPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; from?: string; to?: string; q?: string }>;
}) {
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd);
  const year = Number((period.month ?? period.from).slice(0, 4));
  const [{ types, rows }, cfg] = await Promise.all([
    leaveReport(period, { q: params.q }, year),
    getLeaveConfig(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker month={period.month} from={period.from} to={period.to} />
        <NameSearch q={params.q} params={params} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <EmptyState icon={<Calendar size={28} />} title="ไม่มีข้อมูลในช่วงนี้" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2.5">พนักงาน</th>
                {types.map((t) => (
                  <th key={t.id} className="px-4 py-2.5 text-right">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-gray-50">
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
                            {baht(cell.deductAmount)})
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
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
