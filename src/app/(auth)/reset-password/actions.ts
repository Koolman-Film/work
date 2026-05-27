'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const ResetSchema = z.object({
  email: z.string().email(),
});

export async function requestPasswordReset(formData: FormData) {
  const parsed = ResetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    redirect(`/reset-password?error=${encodeURIComponent('กรุณากรอกอีเมลที่ถูกต้อง')}`);
  }

  // Build the redirect URL from the request's own Host header so dev/prod/preview
  // all work without needing a separate NEXT_PUBLIC_APP_URL env var.
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const callbackUrl = `${proto}://${host}/auth/callback?next=/update-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl,
  });

  // Either way we show "sent" — never reveal whether the email exists in our system.
  // This matches Supabase's own behavior: the API succeeds even for unknown emails.
  if (error) {
    // Only surface rate-limit; everything else falls through to "sent".
    if (error.code === 'over_email_send_rate_limit') {
      redirect(`/reset-password?error=${encodeURIComponent('ส่งคำขอบ่อยเกินไป รออีกสักครู่')}`);
    }
  }

  redirect('/reset-password?sent=1');
}
