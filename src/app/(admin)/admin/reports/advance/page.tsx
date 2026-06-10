import { Banknote } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceReport } from '@/lib/reports/queries';
import { NameSearch } from '../name-search';
import { PeriodPicker } from '../period-picker';

const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;

export default async function AdvanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; from?: string; to?: string; q?: string }>;
}) {
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd);
  const rows = await advanceReport(period, { q: params.q });

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
        <NameSearch q={params.q} params={params} />
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
                  <td className="px-4 py-2.5 text-right">{baht(r.approvedInPeriod)}</td>
                  <td className="px-4 py-2.5 text-right">{baht(r.outstandingNow)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.availableNow == null ? '—' : baht(r.availableNow)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-medium">
              <tr>
                <td className="px-4 py-2.5">รวม {rows.length} คน</td>
                <td className="px-4 py-2.5 text-right">{baht(totals.approvedInPeriod)}</td>
                <td className="px-4 py-2.5 text-right">{baht(totals.outstandingNow)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
