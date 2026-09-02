import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { previewAbsences } from '@/lib/attendance/absence-preview';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { formatTHB } from '@/lib/format';
import { currentMonthYM } from '@/lib/leave/team-calendar-shape';

/**
 * What absence derivation WOULD charge, if it were switched on.
 *
 * Absence does not exist in this system yet: `Absent` rows come only from the
 * admin manual-entry form, so payroll deducts only what somebody keyed. Turning
 * that into a derivation is the largest money change in the backlog — it moves
 * `deductAttendance` for potentially every employee at once. This page exists so
 * that change can be READ before it is made. It computes; it never writes, and
 * no payroll figure anywhere consumes it.
 *
 * What to read from it:
 *   - A row with many derived days → either a genuine no-show run, or leave
 *     that was never recorded. Check the leave first.
 *   - Employees listed as skipped → they have no WorkSchedule. Derivation
 *     refuses to guess for them, because assuming Mon–Sat would charge a day's
 *     pay for every real day off.
 *   - A total near or above the employee's salary → derivation is wrong for
 *     them, not merely expensive. Do not enable until it is understood.
 *
 * Gated on payroll.read, matching /admin/tools/leave-backlog: it shows money
 * the payroll team already sees, grouped so the cause is legible.
 */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function AbsencePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requireGlobalPermission('payroll.read');
  const params = await searchParams;
  const month = params.m && MONTH_RE.test(params.m) ? params.m : currentMonthYM();
  const preview = await previewAbsences(month);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เครื่องมือ"
        title="ตัวอย่างการคิดวันขาดงานอัตโนมัติ"
        subtitle={`งวด ${preview.from} – ${preview.to} — ดูอย่างเดียว ยังไม่มีการหักเงินจริง`}
      />

      <div className="mb-5 space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          <strong>หน้านี้ไม่หักเงินใคร</strong> — ปัจจุบันระบบจะนับว่าขาดงานก็ต่อเมื่อแอดมินคีย์เองเท่านั้น หน้านี้แสดงว่า
          <strong>ถ้า</strong>เปิดใช้การคิดอัตโนมัติแล้วจะได้ผลอย่างไร เพื่อให้ตรวจสอบก่อนตัดสินใจ
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>วันที่มีการเช็คอิน หรือมีใบลาครอบคลุม จะไม่ถูกนับ</li>
          <li>วันที่แอดมินคีย์ขาดงานไว้เองแล้ว จะไม่ถูกนับซ้ำ</li>
          <li>
            ใบลาที่ไม่ได้บันทึกจำนวนนาทีไว้ ระบบจะถือว่า<strong>ลาเต็มวัน</strong> เพื่อไม่ให้หักเงินผิด
          </li>
          {preview.skippedNoSchedule > 0 && (
            <li>ข้ามพนักงาน {preview.skippedNoSchedule} คนที่ยังไม่ได้กำหนดตารางงาน — ระบบจะไม่เดาให้</li>
          )}
        </ul>
      </div>

      {preview.rows.length === 0 ? (
        <EmptyState title="ไม่มีวันขาดงานที่จะคิดในงวดนี้" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-sunken text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2">พนักงาน</th>
                <th className="px-3 py-2 text-right">จำนวนวัน</th>
                <th className="px-3 py-2 text-right">ประมาณการหัก</th>
                <th className="px-3 py-2 text-right">เงินเดือน</th>
                <th className="px-3 py-2">วันที่</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-line-soft align-top">
                  <td className="px-3 py-2 text-ink-1">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalDays.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatTHB(r.estimatedBaht)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">
                    {formatTHB(r.baseSalary)}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {r.days.map((d) => d.date).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
