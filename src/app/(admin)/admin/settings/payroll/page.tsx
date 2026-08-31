import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { updatePayrollConfig } from './actions';
import { SsoCard } from './sso-card';

export default async function PayrollConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requireGlobalPermission('settings.payroll.manage');
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
        <form action={updatePayrollConfig} className="space-y-6">
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
                <FormField
                  label="หักขาดงาน/วัน (บาท) — เฉพาะพนักงานรายชั่วโมง"
                  htmlFor="absentDeductionPerDay"
                  hint='ใช้เป็นค่าสำรองสำหรับพนักงานรายชั่วโมง (หรือฐานเงินเดือน 0/ไม่ถูกต้อง) เท่านั้น พนักงานรายเดือนหักตามเงินเดือน/"วันทำงาน/เดือน" ด้านบน พนักงานรายวันหักตามค่าจ้างรายวันจริง — ไม่มีผลกับสองกลุ่มนี้'
                >
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
              <FormField
                label="เพดานหักวันลาเกินสิทธิต่อเดือน (% ของเงินเดือน)"
                htmlFor="leaveDeductMaxPercent"
                hint="วันลาเกินสิทธิที่ค้างสะสมจะถูกทยอยหัก ไม่เกิน % นี้ของเงินเดือนในแต่ละงวด ส่วนที่เหลือยกไปงวดถัดไป — ป้องกันไม่ให้ยอดค้างก้อนใหญ่ทำให้เงินเดือนสุทธิติดลบ ใส่ 0 = หักทั้งหมดทีเดียว (ไม่จำกัด)"
              >
                <Input
                  id="leaveDeductMaxPercent"
                  name="leaveDeductMaxPercent"
                  inputMode="numeric"
                  defaultValue={String(cfg.leaveDeductMaxPercent)}
                  required
                  className="max-w-xs"
                />
              </FormField>
              <p className="text-sm text-ink-4">
                นโยบายมาสาย (3 ครั้ง / สายรุนแรง) ตั้งค่าที่หน้า "การมาสาย & รอบจ่าย"
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>การเบิกล่วงหน้า</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="ขั้นต่ำเงินคงเหลือ (บาท)"
                  htmlFor="advanceMinRemaining"
                  hint="จำนวนเงินที่ต้องเหลือไว้เสมอ ระบบจะหักออกจากวงเงินที่เบิกได้ เพื่อไม่ให้เบิกจนเงินเดือนเหลือศูนย์ — ใส่ 0 หากไม่ต้องการกำหนด"
                >
                  <Input
                    id="advanceMinRemaining"
                    name="advanceMinRemaining"
                    inputMode="decimal"
                    defaultValue={cfg.advanceMinRemaining.toString()}
                    required
                  />
                </FormField>
                <FormField
                  label="ช่วงห้ามกดเบิก (วันก่อนวันตัดรอบ)"
                  htmlFor="advanceBlackoutDays"
                  hint="นับถอยหลังจากวันตัดรอบ รวมวันตัดรอบด้วย เช่น ใส่ 3 เมื่อวันตัดรอบคือวันที่ 25 จะห้ามกดเบิกวันที่ 23–25 — ห้ามเฉพาะการยื่นคำขอ แอดมินยังอนุมัติรายการที่ค้างอยู่ได้ ใส่ 0 หากไม่ต้องการกำหนด"
                >
                  <Input
                    id="advanceBlackoutDays"
                    name="advanceBlackoutDays"
                    inputMode="numeric"
                    defaultValue={String(cfg.advanceBlackoutDays)}
                    required
                  />
                </FormField>
              </div>
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
