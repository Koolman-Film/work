import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * Shared form for creating a new admin/owner account.
 *
 * Edit mode uses a separate, more specialized layout (split into "role"
 * + "reset password" + "archive" sections) — see /edit/page.tsx. This
 * form is create-only.
 *
 * Role select options are filtered to what the *acting* user is
 * permitted to grant:
 *   - Admin actor → ['Admin'] only
 *   - Owner actor → ['Admin', 'Superadmin']
 *
 * The server re-validates this; the UI filter is just so admins don't
 * see a disabled "Owner" option pointlessly.
 */

type Props = {
  action: (formData: FormData) => Promise<void>;
  error?: string | null;
  /** Carried back across redirect so the email field doesn't lose its value. */
  email?: string | null;
  /** Roles the actor is permitted to assign. */
  availableRoles: ReadonlyArray<'Admin' | 'Superadmin'>;
};

export function TeamCreateForm({ action, error, email, availableRoles }: Props) {
  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>เพิ่มผู้ดูแลใหม่</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <FormField label="อีเมล" htmlFor="email" required hint="ใช้สำหรับเข้าสู่ระบบ — ไม่ต้องยืนยันอีเมล">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="off"
              maxLength={120}
              defaultValue={email ?? ''}
              autoFocus
            />
          </FormField>

          <FormField
            label="รหัสผ่านชั่วคราว"
            htmlFor="password"
            required
            hint="อย่างน้อย 8 ตัวอักษร — ส่งให้ผู้ใช้ใหม่ทาง LINE หรือพบกันตรงๆ"
          >
            <Input
              id="password"
              name="password"
              type="text"
              required
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              className="font-mono"
            />
          </FormField>

          <FormField label="บทบาท" htmlFor="role" required>
            <select
              id="role"
              name="role"
              required
              defaultValue="Admin"
              className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            >
              {availableRoles.includes('Admin') && (
                <option value="Admin">Admin — จัดการพนักงาน + การลา + เช็คอิน</option>
              )}
              {availableRoles.includes('Superadmin') && (
                <option value="Superadmin">Superadmin — สิทธิ์เต็ม รวมจัดการผู้ดูแล</option>
              )}
            </select>
          </FormField>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <Link href="/admin/settings/team">
            <Button type="button" variant="secondary">
              ยกเลิก
            </Button>
          </Link>
          <Button type="submit">สร้างบัญชี</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
