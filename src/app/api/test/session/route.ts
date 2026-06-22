import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * TEST-ONLY programmatic login — mints a REAL Supabase session so e2e can
 * drive worker (LIFF) flows without the LINE OIDC handshake.
 *
 * Why this exists: workers authenticate via LINE → Supabase at /liff/pair,
 * which Playwright can't replay. But /liff/check-in only needs a valid
 * Supabase session cookie (requireRole reads it). This route performs a
 * normal password sign-in and lets @supabase/ssr write the correctly-chunked
 * sb-* cookies onto the response — Playwright's context then holds the
 * session. It is NOT an auth bypass: real Supabase credentials are required.
 *
 * HARD-GATED so it can never ship live:
 *   - 404 in production builds (NODE_ENV === 'production')
 *   - 404 unless E2E_TEST_LOGIN === '1' is explicitly set (CI/e2e only)
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production' || process.env.E2E_TEST_LOGIN !== '1') {
    return new NextResponse('Not found', { status: 404 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : null;
  const password = typeof body.password === 'string' ? body.password : null;
  if (!email || !password) {
    return NextResponse.json({ error: 'missing-credentials' }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // signInWithPassword set the session cookies on this response via the SSR
  // client's cookie adapter. Nothing else to return.
  return NextResponse.json({ ok: true });
}
