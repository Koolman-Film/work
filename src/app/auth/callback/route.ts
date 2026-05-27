/**
 * OAuth / magic-link callback handler.
 *
 * Supabase redirects the user here after they click a password-reset
 * email (and in the future, after any OAuth provider flow). We exchange
 * the one-time `code` param for a session, then send the user onward
 * to the URL passed via `next`.
 *
 * Lives at /auth/callback (NOT under (auth) route group, so middleware
 * doesn't bounce already-authenticated users away mid-callback).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    // Malformed — back to login with a hint
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('ลิงก์ไม่ถูกต้อง')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('ลิงก์หมดอายุ — ขอลิงก์ใหม่')}`,
    );
  }

  // Honor `next` only if it's a relative path on our origin (open-redirect defense).
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(`${origin}${target}`);
}
