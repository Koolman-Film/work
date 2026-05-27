import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';

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
      initial: { name: string; description: string | null };
      error?: string | null;
      extraActions?: React.ReactNode;
    };

export function DepartmentForm({ mode, action, initial, error, extraActions }: Props) {
  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? 'เพิ่มแผนกใหม่' : 'แก้ไขแผนก'}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <FormField label="ชื่อแผนก" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              maxLength={80}
              defaultValue={initial?.name ?? ''}
              autoFocus
            />
          </FormField>
          <FormField label="คำอธิบาย" htmlFor="description" hint="ไม่บังคับ">
            <Textarea
              id="description"
              name="description"
              rows={3}
              maxLength={500}
              defaultValue={initial?.description ?? ''}
            />
          </FormField>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <Link href="/admin/departments">
            <Button type="button" variant="secondary">
              ยกเลิก
            </Button>
          </Link>
          <div className="flex gap-2">
            {extraActions}
            <Button type="submit">{mode === 'create' ? 'สร้างแผนก' : 'บันทึก'}</Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
