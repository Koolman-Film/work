import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
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
    <form action={updateLeaveConfig}>
      <Card>
        <CardHeader>
          <CardTitle>ตั้งค่าการลา — ช่วงครึ่งวัน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {sp.error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {sp.error}
            </p>
          )}
          {sp.ok && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">บันทึกแล้ว</p>
          )}
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
          <p className="text-sm text-gray-500">
            วันทำงานมาตรฐาน = <strong>{formatDaysHours(std, cfg)}</strong>
          </p>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button type="submit">บันทึก</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
