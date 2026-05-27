import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { signIn } from './actions';

type SearchParams = Promise<{ redirectTo?: string; error?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { redirectTo, error } = await searchParams;

  return (
    <form action={signIn} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />

      <FormField label="อีเมล" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
        />
      </FormField>

      <FormField label="รหัสผ่าน" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </FormField>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full">
        เข้าสู่ระบบ
      </Button>

      <div className="border-t border-gray-100 pt-4 text-center text-sm">
        <Link href="/reset-password" className="text-primary-600 hover:text-primary-700">
          ลืมรหัสผ่าน?
        </Link>
      </div>

      <div className="text-center text-xs text-gray-400">พนักงาน: เข้าสู่ระบบผ่านแอป LINE</div>
    </form>
  );
}
