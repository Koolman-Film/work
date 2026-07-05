import { getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from './document';
import { fontFaceCss } from './fonts';
import { payslipPeriodLabel, type ResolvedLetterhead, resolveLetterhead } from './letterhead';
import { renderPayslipPdf } from './pdf';
import { buildPayslipHtml } from './render-html';
import { getOrRenderPayslipPdf } from './storage';

type WarmTarget = { employeeId: string; locale: string | null };

/**
 * Pre-render + cache the freshly-published PDFs so an employee's FIRST LIFF
 * open is instant instead of paying the ~1s Chromium render.
 *
 * Best-effort and side-effect-only: meant to run AFTER the response (Next's
 * `after()`), reusing the warm browser singleton. Never throws — a failure
 * just means that slip falls back to lazy render on first open.
 *
 * Locale matters: the storage cache key is locale-agnostic (first render
 * wins), so we render each slip in the EMPLOYEE's own locale to match what
 * they'd get lazily — falling back to the company default when unset.
 * Translators are memoized per locale across the batch.
 */
export async function warmPublishedPayslips(args: {
  month: string;
  targets: WarmTarget[];
}): Promise<void> {
  if (args.targets.length === 0) return;

  const translators = new Map<Locale, Awaited<ReturnType<typeof getTranslations>>>();
  const translatorFor = async (locale: Locale) => {
    const cached = translators.get(locale);
    if (cached) return cached;
    const tr = await getTranslations({ locale });
    translators.set(locale, tr);
    return tr;
  };

  const letterheadCache = new Map<string, Promise<ResolvedLetterhead>>();
  const letterheadFor = (lh: import('./types').PayslipDocument['meta']['letterhead']) => {
    const cacheKey = JSON.stringify(lh);
    let p = letterheadCache.get(cacheKey);
    if (!p) {
      p = resolveLetterhead(lh);
      letterheadCache.set(cacheKey, p);
    }
    return p;
  };

  for (const target of args.targets) {
    const locale: Locale = isLocale(target.locale) ? target.locale : DEFAULT_LOCALE;
    // Reference (second-line) language: English for Thai slips, Thai otherwise.
    const refLocale: Locale = locale === 'th' ? 'en' : 'th';
    try {
      const doc = await getPayslipDocument(target.employeeId, args.month);
      if (!doc) continue;
      const letterhead = await letterheadFor(doc.meta.letterhead);
      const [t, tRef] = [await translatorFor(locale), await translatorFor(refLocale)];
      await getOrRenderPayslipPdf({
        employeeId: target.employeeId,
        month: args.month,
        render: () =>
          renderPayslipPdf(
            buildPayslipHtml(doc, {
              locale,
              t: (k, v) => t(k as Parameters<typeof t>[0], v as Parameters<typeof t>[1]),
              tRef: (k) => tRef(k as Parameters<typeof tRef>[0]),
              money: (n) => formatMoney(n, locale),
              fontFace: fontFaceCss(locale),
              logoSvg: letterhead.logoHtml,
              companyEn: letterhead.companyEn,
              companyNative: letterhead.companyNative,
              periodLabel: payslipPeriodLabel(locale, args.month),
              generatedAt: new Date().toISOString(),
            }),
          ),
      });
    } catch (err) {
      console.error('[payslip-warm] failed to pre-render', {
        employeeId: target.employeeId,
        month: args.month,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
