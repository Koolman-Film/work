'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const UpdateSchema = z
  .object({
    password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร'),
    confirm: z.string().min(1),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'รหัสผ่านไม่ตรงกัน',
    path: ['confirm'],
  });

export async function updatePassword(formData: FormData) {
  const parsed = UpdateSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/update-password?error=${encodeURIComponent(first)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    const message =
      error.code === 'same_password' ? 'รหัสผ่านใหม่ต้องไม่เหมือนเดิม' : 'ไม่สามารถอัปเดตรหัสผ่านได้ ลองอีกครั้ง';
    redirect(`/update-password?error=${encodeURIComponent(message)}`);
  }

  // Success — they're authenticated, send them to the home page which
  // will route to /admin or /owner once W1c lands the role check.
  redirect('/');
}
