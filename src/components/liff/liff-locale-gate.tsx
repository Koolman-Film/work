'use client';

import { useEffect, useState } from 'react';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { type LiffLocaleSync, syncLiffLocale } from '@/lib/i18n/liff-locale';
import { LanguageModal } from './language-modal';

/**
 * Mounted once in the LIFF layout. On entry it reconciles the locale
 * (DB wins) and decides whether to show the first-run modal. The DB
 * preselect is refined client-side with liff.getLanguage() when the LINE
 * SDK is available — best-effort, never throws.
 */
export function LiffLocaleGate() {
  const [sync, setSync] = useState<LiffLocaleSync | null>(null);
  const [liffLang, setLiffLang] = useState<Locale | null>(null);

  useEffect(() => {
    let cancelled = false;
    syncLiffLocale().then((r) => {
      if (!cancelled) setSync(r);
    });
    // Best-effort: LINE's app language as a smarter preselect. Guarded so
    // a missing/uninitialised SDK never breaks the gate.
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        const tag = liff.getLanguage?.();
        const base = tag?.toLowerCase().split('-')[0];
        if (base && isLocale(base)) setLiffLang(base);
        else if (tag && isLocale(tag)) setLiffLang(tag);
      } catch {
        /* SDK not ready — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sync?.paired || !sync.showModal) return null;

  // Preselect priority: an explicit admin/effective default always wins (even
  // when it is 'th'); otherwise the LINE app language refines our guess.
  const preselect =
    sync.preselectSource === 'admin' ? sync.preselect : (liffLang ?? sync.preselect);
  return <LanguageModal preselect={preselect} />;
}
