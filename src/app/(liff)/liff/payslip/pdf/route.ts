import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requireEmployee } from '@/lib/auth/require-role';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from '@/lib/payslip/document';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { payslipPeriodLabel, resolveLetterhead } from '@/lib/payslip/letterhead';
import { renderPayslipPdf } from '@/lib/payslip/pdf';
import { buildPayslipHtml } from '@/lib/payslip/render-html';
import { getOrRenderPayslipPdf } from '@/lib/payslip/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request): Promise<Response> {
  const { user, employee } = await requireEmployee();

  const month = new URL(req.url).searchParams.get('m') ?? '';
  if (!MONTH_RE.test(month)) return new NextResponse('Bad month', { status: 400 });

  const doc = await getPayslipDocument(employee.id, month);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const letterhead = await resolveLetterhead(doc.meta.letterhead);

  try {
    // Render in the EMPLOYEE's own language (not the request cookie), with the
    // reference second line in English (Thai slips) or Thai (everyone else).
    // The chosen language lives on User.locale (set by the LIFF language modal).
    const locale: Locale = isLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
    const refLocale: Locale = locale === 'th' ? 'en' : 'th';
    const [t, tRef] = await Promise.all([
      getTranslations({ locale }),
      getTranslations({ locale: refLocale }),
    ]);

    const { signedUrl, fromCache } = await getOrRenderPayslipPdf({
      employeeId: employee.id,
      month,
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
            periodLabel: payslipPeriodLabel(locale, month),
            generatedAt: new Date().toISOString(),
          }),
        ),
    });

    auditLog({
      actorId: user.id,
      action: 'payslip.download',
      entityType: 'Payroll',
      entityId: `${employee.id}:${month}`,
      metadata: { source: 'liff', month, fromCache },
    });

    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('[payslip-pdf] render failed', {
      employeeId: employee.id,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate payslip', { status: 500 });
  }
}
