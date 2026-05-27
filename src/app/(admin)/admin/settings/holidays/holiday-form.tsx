import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

type Initial = {
  /** YYYY-MM-DD — pre-formatted so the date input doesn't shift timezones. */
  date: string;
  name: string;
  isSubstitute: boolean;
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

export function HolidayForm({ mode, action, initial, error, extraActions }: Props) {
  return (
    <>
      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'create' ? 'เพิ่มวันหยุดใหม่' : 'แก้ไขวันหยุด'}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <FormField label="วันที่" htmlFor="date" required>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={initial?.date ?? ''}
                className="max-w-xs"
                autoFocus={mode === 'create'}
              />
            </FormField>

            <FormField
              label="ชื่อวันหยุด"
              htmlFor="name"
              required
              hint="เช่น วันแรงงาน, วันสงกรานต์, วันพ่อแห่งชาติ"
            >
              <Input
                id="name"
                name="name"
                required
                maxLength={100}
                defaultValue={initial?.name ?? ''}
                autoFocus={mode === 'edit'}
              />
            </FormField>

            <FormField label="วันหยุดชดเชย" htmlFor="isSubstitute">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="isSubstitute"
                  name="isSubstitute"
                  defaultChecked={initial?.isSubstitute ?? false}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">เป็นวันหยุดชดเชย</span>
                  <span className="block text-xs text-gray-500">
                    ติ๊กถูกหากเป็นวันหยุดชดเชยจาก ครม. หรือเลื่อนจากวันหยุดที่ตรงกับวันอาทิตย์
                  </span>
                </span>
              </label>
            </FormField>
          </CardBody>
          <CardFooter className="flex items-center justify-between">
            <Link href="/admin/settings/holidays">
              <Button type="button" variant="secondary">
                ยกเลิก
              </Button>
            </Link>
            <Button type="submit">{mode === 'create' ? 'เพิ่มวันหยุด' : 'บันทึก'}</Button>
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
