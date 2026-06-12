'use client';

/**
 * Session gate for /liff/admin/* deep links.
 *
 * Problem: rich-menu deep links open these pages in the LIFF webview, which
 * may not have a Supabase session yet (first open, or expired cookies). The
 * server pages gate via requireLiffAdmin() → notFound() without a session,
 * and the proxy carves /liff/admin out of the /login redirect so this
 * component gets a chance to run.
 *
 * Flow on mount:
 *   1. supabase.auth.getSession() — if a custom:line session already exists
 *      (the common case after pairing), render children immediately; the
 *      server already rendered the real page.
 *   2. Otherwise run liffBootstrap() (LIFF init → LINE OIDC → Supabase
 *      signInWithIdToken) and router.refresh() so the server re-renders
 *      the page WITH the new session cookie.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';
import { createClient } from '@/lib/supabase/browser';

type GateState = 'checking' | 'ready' | 'error';

export function LiffSessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const hasLineSession = (data.session?.user.identities ?? []).some(
        (i) => i.provider === 'custom:line',
      );
      if (hasLineSession) {
        // Server already rendered with this session — nothing to refresh.
        if (!cancelled) setState('ready');
        return;
      }
      try {
        await liffBootstrap();
        if (cancelled) return;
        // Session cookie just got written — commit the ready state BEFORE
        // the RSC refresh so a mid-refresh remount can't flash back to
        // "checking", then re-render the server tree so requireLiffAdmin
        // sees the session and the real page replaces the 404.
        setState('ready');
        router.refresh();
      } catch (err) {
        if (cancelled) return;
        const e = err as LiffBootstrapError;
        setErrorMsg(
          e?.kind === 'not-in-line'
            ? 'กรุณาเปิดลิงก์นี้ในแอป LINE บนมือถือ'
            : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        );
        setState('error');
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === 'checking') {
    return <div className="px-4 py-16 text-center text-sm text-gray-500">กำลังเข้าสู่ระบบ…</div>;
  }
  if (state === 'error') {
    return <div className="px-4 py-16 text-center text-sm text-red-600">{errorMsg}</div>;
  }
  return <>{children}</>;
}
