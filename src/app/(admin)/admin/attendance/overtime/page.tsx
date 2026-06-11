import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { approveOt, dismissOt, voidOt } from '@/lib/overtime/actions';
import { getOtCandidates } from '@/lib/overtime/candidates';
import { AttendanceTabs } from '../attendance-tabs';
import { RateModeFields, RateModeFieldsHidden } from './overtime-forms';

function shiftYm(ym: string, deltaMonths: number): string {
  const parts = ym.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  return new Date(Date.UTC(y, m - 1 + deltaMonths, 1)).toISOString().slice(0, 7);
}
const prevYm = (ym: string) => shiftYm(ym, -1);
const nextYm = (ym: string) => shiftYm(ym, 1);

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; error?: string }>;
}) {
  await requirePermission('attendance.overtime.manage');
  const sp = await searchParams;
  const nowYm = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : nowYm;

  const [yStr, mStr] = ym.split('-');
  const start = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1));
  const end = new Date(Date.UTC(Number(yStr), Number(mStr), 1));

  const [candidates, history, employees] = await Promise.all([
    getOtCandidates({ ym }),
    prisma.overtimeEntry.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }],
      select: {
        id: true,
        date: true,
        minutes: true,
        rateType: true,
        ratePerHour: true,
        multiplier: true,
        computedAmount: true,
        status: true,
        note: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null, status: { not: 'Archived' } },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, nickname: true },
    }),
  ]);

  const empName = (e: { firstName: string; lastName: string; nickname: string | null }) =>
    e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim();
  const hours = (min: number) => (min / 60).toFixed(2);
  const approvedTotal = history
    .filter((h) => h.status === 'Approved')
    .reduce((s, h) => s + Number(h.computedAmount), 0);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="ค่าล่วงเวลา (OT)"
        subtitle="อนุมัติ OT จากเวลาออกงานจริง หรือเพิ่มรายการเอง — สรุปยอดต่อเดือน"
      />
      <AttendanceTabs current="overtime" />

      {sp.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          {sp.error}
        </p>
      )}

      <div className="flex items-center gap-3 text-sm">
        <a
          href={`/admin/attendance/overtime?ym=${prevYm(ym)}`}
          className="text-primary-700 hover:text-primary-800 hover:underline"
        >
          ← เดือนก่อน
        </a>
        <span className="font-medium tabular-nums">{ym}</span>
        <a
          href={`/admin/attendance/overtime?ym=${nextYm(ym)}`}
          className="text-primary-700 hover:text-primary-800 hover:underline"
        >
          เดือนถัดไป →
        </a>
      </div>

      {/* Candidates */}
      <Card>
        <CardHeader>
          <CardTitle>ผู้เข้าข่าย OT (จากเวลาออกงาน)</CardTitle>
        </CardHeader>
        <CardBody>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-3">ไม่มีรายการเข้าข่ายในเดือนนี้</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-ink-4">
                    <th className="py-2 pr-3">พนักงาน</th>
                    <th className="px-2">วันที่</th>
                    <th className="px-2">ออกงาน</th>
                    <th className="px-2">นาที OT</th>
                    <th className="px-2">เรท</th>
                    <th className="px-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const formId = `ot-${c.attendanceId}`;
                    return (
                      <tr key={c.attendanceId} className="border-b align-middle">
                        <td className="py-2 pr-3 font-medium">{c.employeeName}</td>
                        <td className="px-2 tabular-nums">{c.date}</td>
                        <td className="px-2 tabular-nums">
                          {c.clockOut} <span className="text-ink-4">(เลิก {c.scheduledEnd})</span>
                        </td>
                        <td className="px-2">
                          <form id={formId} action={approveOt}>
                            <input type="hidden" name="ym" value={ym} />
                            <input type="hidden" name="employeeId" value={c.employeeId} />
                            <input type="hidden" name="date" value={c.date} />
                            <input type="hidden" name="sourceAttendanceId" value={c.attendanceId} />
                            <input
                              name="minutes"
                              type="number"
                              min="1"
                              defaultValue={c.minutesOver}
                              className="w-20 rounded-md border border-gray-300 px-2 py-1"
                            />
                          </form>
                        </td>
                        <td className="px-2">
                          <RateModeFieldsHidden
                            formId={formId}
                            defaultRateType={c.defaultOtRateType}
                            defaultRatePerHour={c.defaultOtRatePerHour}
                            defaultMultiplier={c.defaultOtMultiplier}
                          />
                        </td>
                        <td className="px-2 whitespace-nowrap">
                          <Button form={formId} type="submit" variant="secondary" size="sm">
                            อนุมัติ
                          </Button>
                          <form action={dismissOt} className="mt-1">
                            <input type="hidden" name="ym" value={ym} />
                            <input type="hidden" name="employeeId" value={c.employeeId} />
                            <input type="hidden" name="date" value={c.date} />
                            <input type="hidden" name="sourceAttendanceId" value={c.attendanceId} />
                            <Button type="submit" variant="ghost" size="sm">
                              ไม่ใช่ OT
                            </Button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Manual add */}
      <Card>
        <CardHeader>
          <CardTitle>+ เพิ่ม OT เอง</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={approveOt} className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="ym" value={ym} />
            <select
              name="employeeId"
              required
              className="rounded-md border border-gray-300 px-2 py-1"
            >
              <option value="">— เลือกพนักงาน —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </select>
            <input
              name="date"
              type="date"
              required
              className="rounded-md border border-gray-300 px-2 py-1"
            />
            <input
              name="minutes"
              type="number"
              min="1"
              placeholder="นาที"
              required
              className="w-24 rounded-md border border-gray-300 px-2 py-1"
            />
            <RateModeFields />
            <input
              name="note"
              type="text"
              maxLength={200}
              placeholder="หมายเหตุ"
              className="w-40 rounded-md border border-gray-300 px-2 py-1"
            />
            <Button type="submit" variant="primary" size="sm">
              บันทึก OT
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>ประวัติ OT เดือนนี้ — รวม ฿{approvedTotal.toLocaleString()}</CardTitle>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <p className="text-sm text-ink-3">ยังไม่มีรายการ</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-ink-4">
                    <th className="py-2 pr-3">พนักงาน</th>
                    <th className="px-2">วันที่</th>
                    <th className="px-2">ชม.</th>
                    <th className="px-2">เรท</th>
                    <th className="px-2">จำนวนเงิน</th>
                    <th className="px-2">สถานะ</th>
                    <th className="px-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b align-middle">
                      <td className="py-2 pr-3 font-medium">{empName(h.employee)}</td>
                      <td className="px-2 tabular-nums">{h.date.toISOString().slice(0, 10)}</td>
                      <td className="px-2 tabular-nums">{hours(h.minutes)}</td>
                      <td className="px-2">
                        {h.rateType === 'PerHourAmount'
                          ? `฿${h.ratePerHour}/ชม.`
                          : `×${h.multiplier}`}
                      </td>
                      <td className="px-2 tabular-nums">
                        ฿{Number(h.computedAmount).toLocaleString()}
                      </td>
                      <td className="px-2">{h.status === 'Approved' ? 'อนุมัติ' : 'ไม่ใช่ OT'}</td>
                      <td className="px-2">
                        <form action={voidOt}>
                          <input type="hidden" name="ym" value={ym} />
                          <input type="hidden" name="id" value={h.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            ลบ
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
