/**
 * Logout endpoint — called by any "Sign out" UI element via POST.
 *
 * Form-friendly: pages can do `<form action="/logout" method="post">` and
 * we'll clear the Supabase session + redirect to /login. Works without JS.
 *
 * GET is also accepted so that `<a href="/logout">` links work in a pinch,
 * but POST is the canonical entrypoint for CSRF-safety once we ever add it.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function handleLogout(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });

  const url = new URL('/login', request.url);
  return NextResponse.redirect(url, { status: 303 });
}

export const GET = handleLogout;
export const POST = handleLogout;
