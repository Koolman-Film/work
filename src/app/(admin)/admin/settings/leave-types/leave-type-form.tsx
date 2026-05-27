import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

type Initial = {
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
};

type Props =
  | {
      mode: 'create';
      action: (fd: FormData) => Promise<void>;
      initial?: undefined;
      error?: string | null;
      extraActions?: React.ReactNode;
    }
  | {
      mode: 'edit';
      action: (fd: FormData) => Promise<void>;
      initial: Initial;
      error?: string | null;
      extraActions?: React.ReactNode;
    };

export function LeaveTypeForm({ mode, action, initial, error, extraActions }: Props) {
  return (
    <>
      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'create' ? 'เพิ่มประเภทการลาใหม่' : 'แก้ไขประเภทการลา'}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <FormField label="ชื่อประเภท" htmlFor="name" required hint="เช่น ลาป่วย, ลากิจ, ลาพักร้อน">
              <Input
                id="name"
                name="name"
                required
                maxLength={80}
                defaultValue={initial?.name ?? ''}
                autoFocus
              />
            </FormField>

            {/* isPaid — checkbox with explicit "ลาแบบจ่ายเงิน" label */}
            <FormField label="การจ่ายเงิน" htmlFor="isPaid">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="isPaid"
                  name="isPaid"
                  defaultChecked={initial?.isPaid ?? true}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">ลาแบบจ่ายเงิน</span>
                  <span className="block text-xs text-gray-500">
                    ติ๊กถูกหากการลาประเภทนี้ไม่หักเงินเดือน เช่น ลาป่วย, ลาพักร้อน. ปิดสำหรับลาที่ไม่จ่าย เช่น
                    ลาไม่รับเงิน.
                  </span>
                </span>
              </label>
            </FormField>

            <FormField
              label="โควต้าต่อปี"
              htmlFor="annualQuota"
              hint="จำนวนวันต่อปี — เว้นว่างถ้าไม่จำกัด (เช่น ลาไม่รับเงิน)"
            >
              <Input
                id="annualQuota"
                name="annualQuota"
                type="number"
                min="0"
                max="365"
                step="1"
                placeholder="เช่น 30"
                defaultValue={initial?.annualQuota?.toString() ?? ''}
              />
            </FormField>
          </CardBody>
          <CardFooter className="flex items-center justify-between">
            <Link href="/admin/settings/leave-types">
              <Button type="button" variant="secondary">
                ยกเลิก
              </Button>
            </Link>
            <Button type="submit">{mode === 'create' ? 'สร้างประเภท' : 'บันทึก'}</Button>
          </CardFooter>
        </Card>
      </form>

      {/* "Danger Zone" — destructive actions (archive) live OUTSIDE the
          update form. Nested forms are invalid HTML and would cause the
          archive button to silently submit the update action. */}
      {extraActions && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/30 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">พื้นที่อันตราย</p>
          <p className="mt-1 text-xs text-red-700/80">การกระทำในส่วนนี้ไม่สามารถย้อนกลับได้</p>
          <div className="mt-3 flex justify-end">{extraActions}</div>
        </div>
      )}
    </>
  );
}
