import { BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveReportPeriod } from '@/lib/reports/period';
import { attendanceReport } from '@/lib/reports/queries';
import { NameSearch } from '../name-search';
import { PeriodPicker } from '../period-picker';

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; from?: string; to?: string; q?: string }>;
}) {
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd);
  const rows = await attendanceReport(period, { q: params.q });

  const totals = rows.reduce(
    (a, r) => ({
      lateMinutes: a.lateMinutes + r.lateMinutes,
      earlyMinutes: a.earlyMinutes + r.earlyMinutes,
      absentDays: a.absentDays + r.absentDays,
      otMinutes: a.otMinutes + r.otMinutes,
    }),
    { lateMinutes: 0, earlyMinutes: 0, absentDays: 0, otMinutes: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker month={period.month} from={period.from} to={period.to} />
        <NameSearch q={params.q} params={params} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <EmptyState icon={<BarChart3 size={28} />} title="ไม่มีข้อมูลในช่วงนี้" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2.5">พนักงาน</th>
                <th className="px-4 py-2.5 text-right">มาสาย (ครั้ง)</th>
                <th className="px-4 py-2.5 text-right">สาย (นาที)</th>
                <th className="px-4 py-2.5 text-right">ออกก่อน (ครั้ง)</th>
                <th className="px-4 py-2.5 text-right">ออกก่อน (นาที)</th>
                <th className="px-4 py-2.5 text-right">ขาดงาน (วัน)</th>
                <th className="px-4 py-2.5 text-right">OT (นาที)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">{r.name}</td>
                  <td className="px-4 py-2.5 text-right">{r.lateCount}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.lateMinutes.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-2.5 text-right">{r.earlyCount}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.earlyMinutes.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-2.5 text-right">{r.absentDays}</td>
                  <td className="px-4 py-2.5 text-right">{r.otMinutes.toLocaleString('th-TH')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-medium">
              <tr>
                <td className="px-4 py-2.5">รวม {rows.length} คน</td>
                <td />
                <td className="px-4 py-2.5 text-right">
                  {totals.lateMinutes.toLocaleString('th-TH')}
                </td>
                <td />
                <td className="px-4 py-2.5 text-right">
                  {totals.earlyMinutes.toLocaleString('th-TH')}
                </td>
                <td className="px-4 py-2.5 text-right">{totals.absentDays}</td>
                <td className="px-4 py-2.5 text-right">
                  {totals.otMinutes.toLocaleString('th-TH')}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
