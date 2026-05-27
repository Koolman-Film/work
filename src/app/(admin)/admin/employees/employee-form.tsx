import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type EmployeeFormOptions = {
  branches: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  accountingGroups: Array<{ id: string; name: string }>;
  workSchedules: Array<{ id: string; name: string }>;
};

type Initial = {
  firstName: string;
  lastName: string;
  nickname: string | null;
  branchId: string;
  assignedBranchIds: string[];
  departmentId: string | null;
  accountingGroupId: string | null;
  workScheduleId: string | null;
  salaryType: 'Monthly' | 'Daily' | 'Hourly';
  baseSalary: string; // already stringified Decimal
  status: 'Probation' | 'Active' | 'Archived';
  canCheckIn: boolean;
  hiredAt: string; // YYYY-MM-DD
};

type Props =
  | {
      mode: 'create';
      action: (fd: FormData) => Promise<void>;
      initial?: undefined;
      error?: string | null;
      options: EmployeeFormOptions;
      extraActions?: React.ReactNode;
    }
  | {
      mode: 'edit';
      action: (fd: FormData) => Promise<void>;
      initial: Initial;
      error?: string | null;
      options: EmployeeFormOptions;
      extraActions?: React.ReactNode;
    };

const selectClasses = cn(
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
);

export function EmployeeForm({ mode, action, initial, error, options, extraActions }: Props) {
  const isEdit = mode === 'edit';

  return (
    <form action={action} className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลพนักงาน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="ชื่อจริง" htmlFor="firstName" required>
              <Input
                id="firstName"
                name="firstName"
                required
                maxLength={80}
                defaultValue={initial?.firstName ?? ''}
                autoFocus={!isEdit}
              />
            </FormField>
            <FormField label="นามสกุล" htmlFor="lastName" required>
              <Input
                id="lastName"
                name="lastName"
                required
                maxLength={80}
                defaultValue={initial?.lastName ?? ''}
              />
            </FormField>
          </div>
          <FormField label="ชื่อเล่น" htmlFor="nickname" hint="ไม่บังคับ">
            <Input
              id="nickname"
              name="nickname"
              maxLength={40}
              defaultValue={initial?.nickname ?? ''}
              className="max-w-xs"
            />
          </FormField>
        </CardBody>
      </Card>

      {/* Org assignment */}
      <Card>
        <CardHeader>
          <CardTitle>สังกัด</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <FormField label="สาขาหลัก" htmlFor="branchId" required hint="สาขาที่พนักงานทำงานเป็นหลัก">
            <select
              id="branchId"
              name="branchId"
              required
              defaultValue={initial?.branchId ?? ''}
              className={cn(selectClasses, 'max-w-md')}
            >
              <option value="" disabled>
                — เลือกสาขา —
              </option>
              {options.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="สาขาที่ทำงานได้ (เพิ่มเติม)"
            htmlFor="assignedBranchIds"
            hint="สาขาที่อนุญาตให้พนักงานเช็คอินได้ (นอกเหนือจากสาขาหลัก)"
          >
            <div className="flex flex-wrap gap-3 pt-1">
              {options.branches.map((b) => {
                const checked = initial?.assignedBranchIds.includes(b.id) ?? false;
                return (
                  <label
                    key={b.id}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <input
                      type="checkbox"
                      name="assignedBranchIds"
                      value={b.id}
                      defaultChecked={checked}
                      className="size-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
                    />
                    <span>{b.name}</span>
                  </label>
                );
              })}
            </div>
          </FormField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="แผนก" htmlFor="departmentId" hint="ไม่บังคับ">
              <select
                id="departmentId"
                name="departmentId"
                defaultValue={initial?.departmentId ?? ''}
                className={selectClasses}
              >
                <option value="">— ไม่ระบุ —</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="กลุ่มบัญชี" htmlFor="accountingGroupId" hint="สำหรับ PEAK export">
              <select
                id="accountingGroupId"
                name="accountingGroupId"
                defaultValue={initial?.accountingGroupId ?? ''}
                className={selectClasses}
              >
                <option value="">— ไม่ระบุ —</option>
                {options.accountingGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="ตารางงาน" htmlFor="workScheduleId" hint="ใช้ตรวจสายและคำนวณ OT">
            <select
              id="workScheduleId"
              name="workScheduleId"
              defaultValue={initial?.workScheduleId ?? ''}
              className={cn(selectClasses, 'max-w-md')}
            >
              <option value="">— ไม่ระบุ —</option>
              {options.workSchedules.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </FormField>
        </CardBody>
      </Card>

      {/* Employment */}
      <Card>
        <CardHeader>
          <CardTitle>สถานะการจ้างงาน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="วันเริ่มงาน" htmlFor="hiredAt" required>
              <Input
                id="hiredAt"
                name="hiredAt"
                type="date"
                required
                defaultValue={initial?.hiredAt ?? new Date().toISOString().slice(0, 10)}
                className="max-w-xs"
              />
            </FormField>
            <FormField label="สถานะ" htmlFor="status" required>
              <select
                id="status"
                name="status"
                required
                defaultValue={initial?.status ?? 'Probation'}
                className={cn(selectClasses, 'max-w-xs')}
              >
                <option value="Probation">ทดลองงาน</option>
                <option value="Active">ปกติ</option>
                <option value="Archived">พ้นสภาพ</option>
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="ประเภทเงินเดือน" htmlFor="salaryType" required>
              <select
                id="salaryType"
                name="salaryType"
                required
                defaultValue={initial?.salaryType ?? 'Monthly'}
                className={cn(selectClasses, 'max-w-xs')}
              >
                <option value="Monthly">รายเดือน</option>
                <option value="Daily">รายวัน</option>
                <option value="Hourly">รายชั่วโมง</option>
              </select>
            </FormField>
            <FormField
              label="ฐานเงินเดือน (บาท)"
              htmlFor="baseSalary"
              required
              hint="ต่อเดือน / วัน / ชั่วโมง ตามประเภทด้านซ้าย"
            >
              <Input
                id="baseSalary"
                name="baseSalary"
                type="number"
                step="0.01"
                min={0}
                required
                defaultValue={initial?.baseSalary ?? ''}
                className="max-w-xs"
              />
            </FormField>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="canCheckIn"
                defaultChecked={initial?.canCheckIn ?? true}
                className="size-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
              />
              <span>อนุญาตให้เช็คอินผ่าน LINE LIFF</span>
            </label>
            <p className="ml-6 mt-0.5 text-xs text-gray-500">ปิดได้ชั่วคราว เช่น ระหว่างพักงาน</p>
          </div>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <Link href="/admin/employees">
            <Button type="button" variant="secondary">
              ยกเลิก
            </Button>
          </Link>
          <div className="flex gap-2">
            {extraActions}
            <Button type="submit">{isEdit ? 'บันทึก' : 'สร้างพนักงาน'}</Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
