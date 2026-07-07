import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTHB2, monthLabelTh } from '@/lib/format';

/**
 * Admin-side payslip history for one employee — lists Published/Locked
 * months (newest first, per `loadEmployeePayslipHistory`) with a link to
 * the Task 6 PDF route. Gated by the caller on `payroll.read`; this
 * component itself does no authorization.
 */
export function PayslipHistorySection({
  employeeId,
  history,
}: {
  employeeId: string;
  history: { month: string; netPay: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>สลิปเงินเดือน</CardTitle>
      </CardHeader>
      <CardBody>
        {history.length === 0 ? (
          <p className="text-sm text-ink-4">ยังไม่มีสลิปที่เผยแพร่</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.month} className="flex items-center justify-between py-2">
                <span className="text-sm text-ink-2">{monthLabelTh(h.month)}</span>
                <span className="flex items-center gap-4">
                  <span className="tabular-nums text-sm text-ink-3">{formatTHB2(h.netPay)}</span>
                  <Link
                    href={`/admin/payroll/payslip-pdf?m=${h.month}&employeeId=${employeeId}`}
                    className="text-sm font-medium text-primary-600 hover:underline"
                    download
                  >
                    ดาวน์โหลด PDF
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
