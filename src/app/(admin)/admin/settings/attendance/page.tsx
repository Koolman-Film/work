import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { DEFAULT_LATE_GRACE_MIN, DEFAULT_WORK_START } from '@/lib/attendance/late-policy';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { updateAttendanceConfig } from './actions';

export default async function AttendanceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.attendance.manage');
  const cfg = await prisma.payrollConfig.findFirst({
    select: { workStartTime: true, lateGraceMinutes: true },
  });
  const sp = await searchParams;

  const workStartTime = cfg?.workStartTime ?? DEFAULT_WORK_START;
  const lateGraceMinutes = cfg?.lateGraceMinutes ?? DEFAULT_LATE_GRACE_MIN;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ตั้งค่าการมาสาย"
        subtitle="เวลาเข้างานมาตรฐาน + ระยะผ่อนผัน — ใช้ตัดสินว่าการเช็คอินถือเป็น “มาสาย” หรือไม่"
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

      <form action={updateAttendanceConfig} className="max-w-2xl">
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
          <CardFooter className="flex justify-end">
            <Button type="submit">บันทึก</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
