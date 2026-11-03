import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { DEFAULT_LATE_GRACE_MIN, DEFAULT_WORK_START } from '@/lib/attendance/late-policy';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { formatThaiDate } from '@/lib/format';
import { DEFAULT_CUTOFF_DAY } from '@/lib/payroll/cutoff-load';
import { describeCutoffDay, END_OF_MONTH } from '@/lib/payroll/cutoff-rule';
import { payrollMonthWindowYmd } from '@/lib/payroll/period';
import { addBranchCutoffAction, removeBranchCutoffAction, updateAttendanceConfig } from './actions';

const SELECT_CLASS =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30';

function thaiRange(win: { from: string; to: string }): string {
  const d = (ymd: string) => formatThaiDate(new Date(`${ymd}T00:00:00.000Z`));
  return `${d(win.from)} – ${d(win.to)}`;
}

export default async function AttendanceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.attendance.manage');
  const cfg = await prisma.payrollConfig.findFirst({
    select: {
      workStartTime: true,
      lateGraceMinutes: true,
      cutoffDay: true,
      lateThreeStrikeEnabled: true,
      lateThreeStrikeCount: true,
      severeLateEnabled: true,
      severeLateThresholdMin: true,
    },
  });
  const [branches, branchCutoffs] = await Promise.all([
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.branchPayrollCutoff.findMany({
      orderBy: [{ branchId: 'asc' }, { fromMonth: 'asc' }],
      select: { id: true, branchId: true, fromMonth: true, cutoffDay: true },
    }),
  ]);
  const sp = await searchParams;

  const workStartTime = cfg?.workStartTime ?? DEFAULT_WORK_START;
  const lateGraceMinutes = cfg?.lateGraceMinutes ?? DEFAULT_LATE_GRACE_MIN;
  const cutoffDay = cfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY;
  const lateThreeStrikeEnabled = cfg?.lateThreeStrikeEnabled ?? true;
  const lateThreeStrikeCount = cfg?.lateThreeStrikeCount ?? 3;
  const severeLateEnabled = cfg?.severeLateEnabled ?? true;
  const severeLateThresholdMin = cfg?.severeLateThresholdMin ?? 30;

  // Show the resulting window for the current Bangkok month as a live example.
  const nowYm = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const win = payrollMonthWindowYmd(nowYm, cutoffDay);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const overrideRows = branchCutoffs.map((c) => {
    const rule = {
      globalCutoffDay: cutoffDay,
      overrides: branchCutoffs.filter((o) => o.branchId === c.branchId),
    };
    return {
      ...c,
      branchName: branchName.get(c.branchId) ?? '(สาขาที่ปิดแล้ว)',
      firstWindow: thaiRange(payrollMonthWindowYmd(c.fromMonth, rule)),
    };
  });
  const winFrom = formatThaiDate(new Date(`${win.from}T00:00:00.000Z`));
  const winTo = formatThaiDate(new Date(`${win.to}T00:00:00.000Z`));

  return (
    <div className="p-4">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="การมาสาย & รอบจ่ายเงินเดือน"
        subtitle="เวลาเข้างานมาตรฐาน + ระยะผ่อนผัน และวันตัดรอบสำหรับคำนวณเงินเดือน"
      />

      {sp.error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep"
        >
          {sp.error}
        </div>
      )}
      {sp.ok && (
        <div className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep">
          บันทึกแล้ว
        </div>
      )}

      <form action={updateAttendanceConfig} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>นโยบายการมาสาย</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="เวลาเข้างาน" htmlFor="workStartTime">
                <Input
                  id="workStartTime"
                  name="workStartTime"
                  type="time"
                  defaultValue={workStartTime}
                  required
                />
              </FormField>
              <FormField
                label="ระยะผ่อนผัน (นาที)"
                htmlFor="lateGraceMinutes"
                hint="เช็คอินช้ากว่าเวลาเข้างานเกินกี่นาทีจึงนับว่า “มาสาย” (0 = นับทันที)"
              >
                <Input
                  id="lateGraceMinutes"
                  name="lateGraceMinutes"
                  type="number"
                  min={0}
                  max={480}
                  step={1}
                  defaultValue={lateGraceMinutes}
                  required
                />
              </FormField>
            </div>
            <p className="text-sm text-ink-3">
              เช็คอินหลัง <strong className="tabular-nums text-ink-1">{workStartTime}</strong> เกิน{' '}
              <strong className="tabular-nums text-ink-1">{lateGraceMinutes}</strong> นาที
              จะถูกบันทึกเป็น “มาสาย” อัตโนมัติ และนับรวมในรายงานและการหักเงินเดือน
            </p>
            <p className="text-xs text-ink-4">
              ใช้กับทุกพนักงานที่ยังไม่ได้กำหนดตารางงานเฉพาะตัว — วันอาทิตย์และวันหยุดจะไม่นับ
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>รอบจ่ายเงินเดือน</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <FormField
              label="วันตัดรอบ (1–28)"
              htmlFor="cutoffDay"
              hint="รอบเงินเดือนของเดือนหนึ่ง = วันถัดจากวันตัดรอบของเดือนก่อน ถึงวันตัดรอบของเดือนนี้ เช่น 26 = วันที่ 27 เดือนก่อน ถึงวันที่ 26 เดือนนี้"
            >
              <Input
                id="cutoffDay"
                name="cutoffDay"
                type="number"
                min={1}
                max={28}
                step={1}
                defaultValue={cutoffDay}
                required
              />
            </FormField>
            <p className="text-sm text-ink-3">
              รอบของเดือนนี้: <strong className="text-ink-1">{winFrom}</strong> ถึง{' '}
              <strong className="text-ink-1">{winTo}</strong> — การมาสาย/ขาด/ลา
              ในช่วงนี้จะถูกนำไปคำนวณในรอบเดียวกัน
            </p>
            <p className="text-xs text-ink-4">
              มีผลกับการคำนวณเงินเดือนรอบใหม่เท่านั้น — รอบที่เผยแพร่/ล็อกแล้วจะไม่เปลี่ยน
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>บทลงโทษการมาสาย</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input
                type="checkbox"
                name="lateThreeStrikeEnabled"
                defaultChecked={lateThreeStrikeEnabled}
                className="h-4 w-4 rounded border-ink-5"
              />
              <span>เปิดใช้กฎ “มาสายครบจำนวนครั้ง = หัก 1 วัน”</span>
            </label>
            <FormField
              label="มาสายกี่ครั้ง = หัก 1 วัน"
              htmlFor="lateThreeStrikeCount"
              hint="เช่น 3 = มาสาย 3 ครั้งในรอบ หัก 1 วัน (มาสาย 1–2 ครั้งไม่หัก)"
            >
              <Input
                id="lateThreeStrikeCount"
                name="lateThreeStrikeCount"
                type="number"
                min={1}
                max={31}
                step={1}
                defaultValue={lateThreeStrikeCount}
                required
              />
            </FormField>

            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input
                type="checkbox"
                name="severeLateEnabled"
                defaultChecked={severeLateEnabled}
                className="h-4 w-4 rounded border-ink-5"
              />
              <span>เปิดใช้กฎ “มาสายรุนแรง + ไม่ได้ลา = หัก 1 วัน”</span>
            </label>
            <FormField
              label="เกณฑ์สายรุนแรง (นาทีหลังเวลาเข้างาน)"
              htmlFor="severeLateThresholdMin"
              hint="มาสายเกินกี่นาทีถือว่า “สายรุนแรง” เช่น 30 = เข้างาน 9:31 ขึ้นไป (เมื่อเวลาเข้างาน 9:00) — ถ้าวันนั้นมีการลา จะไม่หักซ้ำ"
            >
              <Input
                id="severeLateThresholdMin"
                name="severeLateThresholdMin"
                type="number"
                min={0}
                max={480}
                step={1}
                defaultValue={severeLateThresholdMin}
                required
              />
            </FormField>
            <p className="text-xs text-ink-4">
              บทลงโทษ “1 วัน” คิดเป็นจำนวนเงินเท่ากับการขาดงาน 1 วัน — แอดมินคีย์มือปรับยกเว้นเป็นรายกรณีได้
            </p>
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button type="submit">บันทึก</Button>
        </div>
      </form>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>รอบตัดเงินเดือนแยกตามสาขา</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-ink-3">
            สาขาที่ไม่ได้ตั้งค่าที่นี่ใช้วันตัดรอบของบริษัท ({describeCutoffDay(cutoffDay)}) — ใช้กับพนักงานตาม
            <strong className="text-ink-1">สาขาหลัก</strong>ของพนักงาน
            เดือนแรกที่เปลี่ยนจะเริ่มต่อจากรอบเดิมเสมอ จึงอาจยาวหรือสั้นกว่าปกติหนึ่งครั้ง
          </p>

          {overrideRows.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {overrideRows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-ink-1">
                      {r.branchName} · {describeCutoffDay(r.cutoffDay)}
                    </div>
                    <div className="text-ink-3">
                      มีผลตั้งแต่รอบเดือน {r.fromMonth} (รอบแรก: {r.firstWindow})
                    </div>
                  </div>
                  <form action={removeBranchCutoffAction.bind(null, r.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      ลบ
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-4">ยังไม่มีสาขาที่ตั้งค่าแยก</p>
          )}

          <form action={addBranchCutoffAction} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <FormField label="สาขา" htmlFor="branchId">
              <select
                id="branchId"
                name="branchId"
                required
                defaultValue=""
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  เลือกสาขา...
                </option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="รอบตัดเงินเดือน" htmlFor="branchCutoffDay">
              <select
                id="branchCutoffDay"
                name="branchCutoffDay"
                required
                defaultValue={END_OF_MONTH}
                className={SELECT_CLASS}
              >
                <option value={END_OF_MONTH}>{describeCutoffDay(END_OF_MONTH)}</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {describeCutoffDay(d)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="มีผลตั้งแต่รอบเดือน"
              htmlFor="fromMonth"
              hint="เปลี่ยนได้เฉพาะเดือนที่ยังไม่เผยแพร่สลิป"
            >
              <Input id="fromMonth" name="fromMonth" type="month" defaultValue={nowYm} required />
            </FormField>
            <div className="flex items-end">
              <Button type="submit">เพิ่ม</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
