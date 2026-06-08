import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { getOrSeedEntitlements } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours, standardDayMinutes } from '@/lib/leave/units';
import { upsertEntitlement } from './entitlements-actions';

export async function EntitlementsSection({
  employeeId,
  year,
}: {
  employeeId: string;
  year: number;
}) {
  const [rows, cfg] = await Promise.all([
    getOrSeedEntitlements(employeeId, year),
    getLeaveConfig(),
  ]);
  const std = standardDayMinutes(cfg);
  // minutes → a clean decimal-days string for input defaultValue (420 → "1", 630 → "1.5")
  const days = (min: number) => String(Number((min / std).toFixed(2)));

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>สิทธิวันลา</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`/admin/employees/${employeeId}/edit?year=${year - 1}`}
            className="text-primary-600 hover:underline"
          >
            ← {year - 1}
          </a>
          <span className="font-medium tabular-nums">ปี {year}</span>
          <a
            href={`/admin/employees/${employeeId}/edit?year=${year + 1}`}
            className="text-primary-600 hover:underline"
          >
            {year + 1} →
          </a>
        </div>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-xs text-ink-4">
          กรอกเป็น “วัน” (เช่น 6, 5.5). ปรับปรุง (Adjustment) ใส่ค่าติดลบได้ เช่น −3.5
          สำหรับวันลาที่ใช้ไปก่อนเริ่มใช้ระบบ. แสดงผลเป็น วัน/ชม. (1 วัน = {std / 60} ชม.).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-ink-4">
                <th className="py-2 pr-3">ประเภท</th>
                <th className="px-2">สิทธิ (วัน)</th>
                <th className="px-2">ยกมา (วัน)</th>
                <th className="px-2">ปรับปรุง (วัน)</th>
                <th className="px-2">ใช้ไป</th>
                <th className="px-2">คงเหลือ</th>
                <th className="px-2">หมายเหตุ</th>
                <th className="px-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.leaveTypeId} className="border-b align-middle">
                  <td className="py-2 pr-3 font-medium text-ink-1">{r.leaveTypeName}</td>
                  <td className="px-2">
                    <form
                      id={`ent-${r.leaveTypeId}`}
                      action={upsertEntitlement.bind(null, employeeId, r.leaveTypeId, year)}
                    >
                      <input
                        name="granted"
                        type="number"
                        step="0.5"
                        min="0"
                        max="366"
                        defaultValue={r.grantedMinutes == null ? '' : days(r.grantedMinutes)}
                        placeholder="ไม่จำกัด"
                        className="w-20 rounded-md border border-gray-300 px-2 py-1"
                      />
                    </form>
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="carryover"
                      type="number"
                      step="0.5"
                      min="0"
                      max="366"
                      defaultValue={days(r.carryoverMinutes)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="adjustment"
                      type="number"
                      step="0.5"
                      min="-366"
                      max="366"
                      defaultValue={days(r.adjustmentMinutes)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2 tabular-nums text-ink-3">
                    {formatDaysHours(r.usedMinutes, cfg)}
                  </td>
                  <td className="px-2 font-medium tabular-nums">
                    {r.remainingMinutes == null
                      ? 'ไม่จำกัด'
                      : formatDaysHours(r.remainingMinutes, cfg)}
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="note"
                      type="text"
                      maxLength={200}
                      defaultValue={r.note ?? ''}
                      className="w-40 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2">
                    <Button
                      form={`ent-${r.leaveTypeId}`}
                      type="submit"
                      variant="secondary"
                      size="sm"
                    >
                      บันทึก
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
