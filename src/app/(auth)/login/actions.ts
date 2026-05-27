'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { loginErrorMessage } from '@/lib/auth/login-error';
import { createClient } from '@/lib/supabase/server';

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional().default(''),
});

// Safe-redirect: only allow relative paths to our own app, never absolute URLs.
// Defends against open-redirect attacks via the `redirectTo` query param.
function safeRedirect(target: string, fallback = '/'): string {
  if (!target?.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}

export async function signIn(formData: FormData) {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') ?? '',
  };
  const parsed = SignInSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent('กรุณากรอกอีเมลและรหัสผ่าน')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const message = loginErrorMessage(error);
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  // Success → bounce to the originally-requested URL (or home).
  redirect(safeRedirect(parsed.data.redirectTo));
}

// Sign out — exposed for direct import; the canonical entry point is
// the route handler at /logout (form POST / GET) so plain HTML works.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
