import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { formatTHB } from '@/lib/format';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { computeLiveLeaveCharges } from '@/lib/leave/recompute';
import { standardDayMinutes } from '@/lib/leave/units';

/**
 * Uncollected over-quota leave, per employee.
 *
 * Exists because of a production row on 2026-08-03: ฿13,500 base, ฿27,450 of
 * leave deduction, net −฿14,625. The deduction was arithmetically correct —
 * 61 days × ฿450 — but nothing in the app showed WHY there were 61 days, or
 * who else was carrying a balance that had not yet come due.
 *
 * The payroll sweep (payroll/run.ts) has no lower date bound: it charges every
 * approved over-quota leave request that has never been swept into a published
 * payroll, however old. So a backlog builds silently and lands whole in
 * whichever month is calculated next. The only symptom is the payroll figure
 * itself, and only once it is already large.
 *
 * This page is the missing view. Read-only — it computes, it never writes.
 *
 * What to read from it:
 *   - ONE row of ~60 days on an employee → a data-entry error, almost
 *     certainly a mistyped end date. Fix the request, do not waive it.
 *   - MANY rows across months → a genuine backlog. The question is then a
 *     policy one (recover at once, spread it, or forgive), not a bug.
 *   - An employee whose total exceeds their monthly salary → their next
 *     payroll goes negative, and publish will refuse them (run.ts's
 *     BlockedNegativeNet guard). Better to see it here first.
 *
 * Gated on payroll.read rather than Superadmin: it is a read-only view of
 * money the payroll team already sees on the payroll page, just grouped so
 * the cause is legible. No new permission, so no backfill migration.
 */
export default async function LeaveBacklogPage() {
  await requireGlobalPermission('payroll.read');

  // Approved leave whose charge was never FROZEN. approveLeaveRequest has
  // frozen chargedMinutes since 0f15b5f (2026-06-08); the rows that remain were
  // all reviewed on or before that date. None should ever appear again — but a
  // null does not fail, it is silently re-derived from the date span on every
  // read (recompute.ts), so its value moves whenever the holiday calendar is
  // edited. That drift is the difference between the ฿27,450 frozen into a
  // payroll draft and the ฿25,650 the same request derives today.
  //
  // Surfaced here rather than logged, because the whole point is that nobody
  // notices otherwise.
  const [charges, cfg, unfrozen] = await Promise.all([
    computeLiveLeaveCharges(),
    getLeaveConfig(),
    prisma.leaveRequest.count({
      where: { status: 'Approved', deletedAt: null, chargedMinutes: null },
    }),
  ]);
  const std = standardDayMinutes(cfg);

  // The backlog is exactly what payroll would sweep next: approved,
  // over-quota, still costing money, and not yet frozen into a published slip.
  const pending = charges.filter((c) => !c.swept && (c.deductAmount ?? 0) > 0);

  const byEmployee = new Map<string, typeof pending>();
  for (const c of pending) {
    const list = byEmployee.get(c.employeeId) ?? [];
    list.push(c);
    byEmployee.set(c.employeeId, list);
  }

  // Salary is what turns a backlog into a negative payslip, so it belongs
  // beside the total rather than a page away.
  const employees = await prisma.employee.findMany({
    where: { id: { in: [...byEmployee.keys()] } },
    select: { id: true, firstName: true, lastName: true, nickname: true, baseSalary: true },
  });
  const empById = new Map(employees.map((e) => [e.id, e]));

  const rows = [...byEmployee.entries()]
    .map(([employeeId, list]) => {
      const total = list.reduce((s, c) => s + (c.deductAmount ?? 0), 0);
      const salary = Number(empById.get(employeeId)?.baseSalary ?? 0);
      const dates = list.map((c) => c.date).sort();
      return {
        employeeId,
        name: list[0]?.employeeName ?? employeeId,
        salary,
        total,
        days: list.reduce((s, c) => s + c.overQuotaMinutes, 0) / std,
        requests: list.length,
        first: dates[0] ?? '',
        last: dates[dates.length - 1] ?? '',
        // The two readings this page exists to separate.
        singleLargeRequest:
          list.length === 1 && list[0] != null && list[0].overQuotaMinutes > 20 * std,
        exceedsSalary: salary > 0 && total > salary,
        list: [...list].sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort((a, b) => b.total - a.total);

  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เครื่องมือ"
        title="วันลาเกินสิทธิที่ยังไม่ได้หัก"
        subtitle="ยอดที่จะถูกหักในรอบเงินเดือนถัดไป — รวมของเก่าที่ค้างมาจากเดือนก่อน ๆ ด้วย"
      />

      {unfrozen > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            มีใบลาที่อนุมัติแล้ว {unfrozen} ใบ ที่ยังไม่ได้บันทึกจำนวนวันไว้ถาวร
          </p>
          <p className="mt-1 text-xs text-amber-800">
            ระบบจะคำนวณจำนวนวันของใบเหล่านี้ใหม่ทุกครั้งที่เปิดดู ทำให้ยอดหักอาจเปลี่ยนเองเมื่อมีการแก้ไขวันหยุดประจำปี
            ใบที่อนุมัติตั้งแต่ 8 มิ.ย. 2569 เป็นต้นมาไม่มีปัญหานี้ — ถ้าตัวเลขนี้เพิ่มขึ้น แปลว่ามีทางเข้าใหม่ที่ไม่ได้บันทึกค่าไว้
          </p>
        </div>
      )}

      <div className="mb-5 space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          การหักวันลาเกินสิทธิ<strong>ไม่ได้จำกัดอยู่แค่เดือนปัจจุบัน</strong> — ใบลาที่อนุมัติแล้วและยังไม่เคยถูกหัก
          จะถูกนำมารวมหักในรอบที่คำนวณครั้งถัดไปทั้งหมด
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>
            <strong>ใบเดียวแต่จำนวนวันเยอะผิดปกติ</strong> → มักเป็นการกรอกวันที่ผิด ให้แก้ใบลานั้น ไม่ใช่ยกเว้นการหัก
          </li>
          <li>
            <strong>หลายใบกระจายหลายเดือน</strong> → เป็นยอดค้างสะสมจริง
            ต้องตัดสินใจเชิงนโยบายว่าจะหักทีเดียวหรือทยอยหัก
          </li>
          <li>ยอดที่เกินเงินเดือน จะทำให้สลิปติดลบ — ระบบจะไม่ยอมเผยแพร่ให้ ต้องแก้ก่อน</li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <div className="surface">
          <EmptyState
            title="ไม่มียอดวันลาเกินสิทธิค้างอยู่"
            hint="ใบลาที่อนุมัติแล้วทุกใบถูกหักครบในรอบเงินเดือนที่ผ่านมาแล้ว"
          />
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-3">
            พบ <strong className="text-ink-1">{rows.length}</strong> คน · รวม{' '}
            <strong className="text-ink-1 tabular-nums">{formatTHB(grand)}</strong>
          </p>

          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.employeeId} className="surface overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                  <div>
                    <p className="font-medium text-ink-1">{r.name}</p>
                    <p className="text-xs text-ink-3">
                      {r.requests} ใบ · {r.days.toFixed(1)} วัน · {r.first} – {r.last}
                      {r.salary > 0 && ` · เงินเดือน ${formatTHB(r.salary)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono font-semibold tabular-nums ${
                        r.exceedsSalary ? 'text-danger-deep' : 'text-ink-1'
                      }`}
                    >
                      {formatTHB(r.total)}
                    </p>
                    {r.exceedsSalary && (
                      <p className="text-xs text-danger-deep">⚠ เกินเงินเดือน — สลิปจะติดลบ</p>
                    )}
                  </div>
                </div>

                {r.singleLargeRequest && (
                  <p className="border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">
                    ⚠ ยอดทั้งหมดมาจากใบลาใบเดียว {r.days.toFixed(1)} วัน — ตรวจวันที่เริ่ม/สิ้นสุดของใบนี้ก่อน
                    มักเป็นการกรอกวันสิ้นสุดผิด
                  </p>
                )}

                <table className="min-w-full divide-y divide-line-soft text-sm">
                  <thead className="bg-surface-muted text-left text-xs text-ink-4">
                    <tr>
                      <th className="px-4 py-2">วันที่เริ่ม</th>
                      <th className="px-4 py-2">ประเภท</th>
                      <th className="px-4 py-2 text-right">เกินสิทธิ (วัน)</th>
                      <th className="px-4 py-2 text-right">จะถูกหัก</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {r.list.map((c) => (
                      <tr key={c.leaveRequestId}>
                        <td className="px-4 py-2 tabular-nums">{c.date}</td>
                        <td className="px-4 py-2 text-ink-2">{c.leaveTypeName}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {(c.overQuotaMinutes / std).toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatTHB(c.deductAmount ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
