/**
 * Letterhead helpers for the payslip PDF.
 *
 * payslipLogoSvg  — inline generic navy seal SVG (default when a branch has no logo).
 * payslipPeriodLabel — localized month label (ported from page.tsx buildMonthLabel).
 * resolveLetterhead — defaults + logo key → render-ready header pieces.
 */

import type { Locale } from '@/lib/i18n/config';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { COMPANY_EN, COMPANY_NATIVE } from './render-html';

const NAVY = '#1a3a78';

/**
 * Returns a generic navy seal as an inline SVG string (48×48): a solid navy
 * disc inside a white ring, with no lettering. Brand-neutral on purpose — it's
 * the default whenever a branch hasn't uploaded its own logo, so it never
 * contradicts the company name rendered beside it.
 */
export function payslipLogoSvg(): string {
  return `<svg class="logo" width="48" height="48" viewBox="0 0 120 120" aria-hidden="true">
  <circle cx="60" cy="60" r="57" fill="#ffffff" stroke="${NAVY}" stroke-width="5"/>
  <circle cx="60" cy="60" r="46" fill="${NAVY}"/>
</svg>`;
}

/**
 * Returns a localized "Month YYYY" label.
 *
 * For Thai: Gregorian month name in Thai + Buddhist Era year (e.g. "มิถุนายน 2569").
 * For all others: locale-formatted month + Gregorian year (e.g. "June 2026").
 *
 * Ported from buildMonthLabel in src/app/(liff)/liff/payslip/page.tsx.
 */
export function payslipPeriodLabel(locale: string, month: string): string {
  const year = Number(month.slice(0, 4));
  const representative = new Date(`${month}-01T00:00:00.000Z`);

  if ((locale as Locale) === 'th') {
    const monthName = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'long',
      timeZone: 'UTC',
    }).format(representative);
    return `${monthName} ${year + 543}`;
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(representative);
}

export type LetterheadInput = {
  payslipNameEn: string | null;
  payslipNameNative: string | null;
  payslipLogoKey: string | null;
};

export type ResolvedLetterhead = {
  companyEn: string;
  companyNative: string;
  logoHtml: string;
};

/**
 * Turn a branch's raw letterhead fields into render-ready header pieces:
 * names fall back to the Koolman defaults; the logo key is downloaded
 * (service-role) and embedded as a self-contained base64 <img>, or the
 * inline SVG when there's no key / the download fails.
 *
 * Stateless on purpose — the logo key is stable under `upsert`, so a
 * process-level cache would serve a stale logo after a replace. Callers
 * that render many slips at once (publish-warming) de-dupe per branch.
 */
export async function resolveLetterhead(input: LetterheadInput): Promise<ResolvedLetterhead> {
  const companyEn = input.payslipNameEn ?? COMPANY_EN;
  const companyNative = input.payslipNameNative ?? COMPANY_NATIVE;

  if (!input.payslipLogoKey) {
    return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .storage.from('attendance-photos')
      .download(input.payslipLogoKey);
    if (error || !data) return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
    const b64 = Buffer.from(await data.arrayBuffer()).toString('base64');
    const logoHtml = `<img class="logo" width="48" height="48" alt="" src="data:image/png;base64,${b64}">`;
    return { companyEn, companyNative, logoHtml };
  } catch (err) {
    console.error('[letterhead] logo download failed', {
      key: input.payslipLogoKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
  }
}
