import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { DEFAULT_LATE_GRACE_MIN, DEFAULT_WORK_START } from '@/lib/attendance/late-policy';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { formatThaiDate } from '@/lib/format';
import { payrollMonthWindowYmd } from '@/lib/payroll/period';
import { updateAttendanceConfig } from './actions';

const DEFAULT_CUTOFF_DAY = 25;

export default async function AttendanceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.attendance.manage');
  const cfg = await prisma.payrollConfig.findFirst({
    select: { workStartTime: true, lateGraceMinutes: true, cutoffDay: true },
  });
  const sp = await searchParams;

  const workStartTime = cfg?.workStartTime ?? DEFAULT_WORK_START;
  const lateGraceMinutes = cfg?.lateGraceMinutes ?? DEFAULT_LATE_GRACE_MIN;
  const cutoffDay = cfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY;

  // Show the resulting window for the current Bangkok month as a live example.
  const nowYm = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const win = payrollMonthWindowYmd(nowYm, cutoffDay);
  const winFrom = formatThaiDate(new Date(`${win.from}T00:00:00.000Z`));
  const winTo = formatThaiDate(new Date(`${win.to}T00:00:00.000Z`));

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
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

      <form action={updateAttendanceConfig} className="max-w-2xl space-y-6">
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

        <div className="flex justify-end">
          <Button type="submit">บันทึก</Button>
        </div>
      </form>
    </div>
  );
}
