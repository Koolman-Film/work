import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { updatePayrollConfig } from './actions';
import { SsoCard } from './sso-card';

export default async function PayrollConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.payroll.manage');
  const cfg = await prisma.payrollConfig.findFirst();
  const sp = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="เงินเดือน"
        subtitle="ประกันสังคม / ค่าล่วงเวลา / รายการหักเงิน — มีผลกับการคำนวณเงินเดือนรอบถัดไป (สลิปเก่าไม่เปลี่ยน)"
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
        <div
          role="status"
          className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep"
        >
          บันทึกแล้ว
        </div>
      )}

      {!cfg ? (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน
        </div>
      ) : (
        <form action={updatePayrollConfig} className="max-w-2xl space-y-6">
          <SsoCard
            defaultRatePercent={cfg.ssoRate.times(100).toString()}
            defaultSalaryCap={cfg.ssoSalaryCap.toString()}
            defaultAmountCap={cfg.ssoAmountCap.toString()}
          />

          <Card>
            <CardHeader>
              <CardTitle>ค่าล่วงเวลา (OT)</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="ตัวคูณ OT" htmlFor="otMultiplier">
                <Input
                  id="otMultiplier"
                  name="otMultiplier"
                  inputMode="decimal"
                  defaultValue={cfg.otMultiplier.toString()}
                  required
                />
              </FormField>
              <FormField label="วันทำงาน/เดือน" htmlFor="workingDaysPerMonth">
                <Input
                  id="workingDaysPerMonth"
                  name="workingDaysPerMonth"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={cfg.workingDaysPerMonth}
                  required
                />
              </FormField>
              <FormField label="เกณฑ์นาทีเข้าข่าย OT" htmlFor="otThresholdMinutes">
                <Input
                  id="otThresholdMinutes"
                  name="otThresholdMinutes"
                  type="number"
                  min={0}
                  max={480}
                  defaultValue={cfg.otThresholdMinutes}
                  required
                />
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>รายการหักเงิน</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="หักขาดงาน/วัน (บาท)" htmlFor="absentDeductionPerDay">
                  <Input
                    id="absentDeductionPerDay"
                    name="absentDeductionPerDay"
                    inputMode="decimal"
                    defaultValue={cfg.absentDeductionPerDay.toString()}
                    required
                  />
                </FormField>
                <FormField label="หักมาสาย (บาท)" htmlFor="lateDeduction">
                  <Input
                    id="lateDeduction"
                    name="lateDeduction"
                    inputMode="decimal"
                    defaultValue={cfg.lateDeduction.toString()}
                    required
                  />
                </FormField>
                <FormField label="หักออกก่อนเวลา (บาท)" htmlFor="earlyLeaveDeduction">
                  <Input
                    id="earlyLeaveDeduction"
                    name="earlyLeaveDeduction"
                    inputMode="decimal"
                    defaultValue={cfg.earlyLeaveDeduction.toString()}
                    required
                  />
                </FormField>
              </div>
              <p className="text-sm text-ink-4">
                นโยบายมาสาย (3 ครั้ง / สายรุนแรง) ตั้งค่าที่หน้า "การมาสาย & รอบจ่าย"
              </p>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">บันทึก</Button>
          </div>
        </form>
      )}
    </div>
  );
}
