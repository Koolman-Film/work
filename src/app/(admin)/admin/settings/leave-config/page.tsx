import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours, standardDayMinutes } from '@/lib/leave/units';
import { updateLeaveConfig } from './actions';

export default async function LeaveConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.leave-config.manage');
  const cfg = await getLeaveConfig();
  const sp = await searchParams;
  const std = standardDayMinutes(cfg);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ตั้งค่าการลา"
        subtitle="กำหนดช่วงเวลาครึ่งวันเช้า/บ่าย — ใช้คำนวณจำนวนวันลาและวันทำงานมาตรฐาน"
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

      <form action={updateLeaveConfig} className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>ช่วงครึ่งวัน</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="เช้า — เริ่ม" htmlFor="morningStart">
                <Input
                  id="morningStart"
                  name="morningStart"
                  type="time"
                  defaultValue={cfg.morningStart}
                  required
                />
              </FormField>
              <FormField label="เช้า — สิ้นสุด" htmlFor="morningEnd">
                <Input
                  id="morningEnd"
                  name="morningEnd"
                  type="time"
                  defaultValue={cfg.morningEnd}
                  required
                />
              </FormField>
              <FormField label="บ่าย — เริ่ม" htmlFor="afternoonStart">
                <Input
                  id="afternoonStart"
                  name="afternoonStart"
                  type="time"
                  defaultValue={cfg.afternoonStart}
                  required
                />
              </FormField>
              <FormField label="บ่าย — สิ้นสุด" htmlFor="afternoonEnd">
                <Input
                  id="afternoonEnd"
                  name="afternoonEnd"
                  type="time"
                  defaultValue={cfg.afternoonEnd}
                  required
                />
              </FormField>
            </div>
            <p className="text-sm text-ink-3">
              วันทำงานมาตรฐาน = <strong>{formatDaysHours(std, cfg)}</strong>
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
