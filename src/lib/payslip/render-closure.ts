import 'server-only';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from './document';
import { fontFaceCss } from './fonts';
import { payslipPeriodLabel, resolveLetterhead } from './letterhead';
import { renderPayslipPdf } from './pdf';
import { buildPayslipHtml } from './render-html';

/**
 * Builds the PDF render closure for one employee's frozen (Published/Locked)
 * slip, in that employee's own locale. Returns null if no frozen slip exists.
 * Shared by the admin single-download route (→ getOrRenderPayslipPdf) and the
 * bulk zip route (→ getPayslipPdfBytes).
 */
export async function buildPayslipRenderClosure(
  employeeId: string,
  month: string,
): Promise<{ render: () => Promise<Buffer> } | null> {
  const doc = await getPayslipDocument(employeeId, month);
  if (!doc) return null;

  const [letterhead, emp] = await Promise.all([
    resolveLetterhead(doc.meta.letterhead),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { user: { select: { locale: true } } },
    }),
  ]);

  const locale: Locale = isLocale(emp?.user?.locale) ? (emp.user.locale as Locale) : DEFAULT_LOCALE;
  const refLocale: Locale = locale === 'th' ? 'en' : 'th';
  const [t, tRef] = await Promise.all([
    getTranslations({ locale }),
    getTranslations({ locale: refLocale }),
  ]);

  const render = () =>
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
        periodLabel: payslipPeriodLabel(locale, month),
        generatedAt: new Date().toISOString(),
      }),
    );

  return { render };
}
