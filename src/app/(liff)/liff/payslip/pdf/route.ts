import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requireEmployee } from '@/lib/auth/require-role';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from '@/lib/payslip/document';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { payslipLogoSvg, payslipPeriodLabel } from '@/lib/payslip/letterhead';
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

  try {
    const locale = await getLocale();
    const [t, tEn] = await Promise.all([
      getTranslations({ locale }),
      getTranslations({ locale: 'en' }),
    ]);

    const { signedUrl, fromCache } = await getOrRenderPayslipPdf({
      employeeId: employee.id,
      month,
      render: () =>
        renderPayslipPdf(
          buildPayslipHtml(doc, {
            locale,
            t: (k, v) => t(k as Parameters<typeof t>[0], v as Parameters<typeof t>[1]),
            tEn: (k) => tEn(k as Parameters<typeof tEn>[0]),
            money: (n) => formatMoney(n, locale as Locale),
            fontFace: fontFaceCss(locale),
            logoSvg: payslipLogoSvg(),
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
