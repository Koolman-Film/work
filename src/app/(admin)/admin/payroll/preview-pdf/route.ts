import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { payslipLogoSvg, payslipPeriodLabel } from '@/lib/payslip/letterhead';
import { renderPayslipPdf } from '@/lib/payslip/pdf';
import { buildPreviewPayslipDocument } from '@/lib/payslip/preview';
import { buildPayslipHtml } from '@/lib/payslip/render-html';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request): Promise<Response> {
  const { user } = await requirePermission('payroll.read');

  const url = new URL(req.url);
  const month = url.searchParams.get('m') ?? '';
  const employeeId = url.searchParams.get('employeeId') ?? '';
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const doc = await buildPreviewPayslipDocument(month, employeeId);
  if (!doc) return new NextResponse('No computable draft', { status: 404 });

  try {
    const locale = await getLocale();
    const [t, tEn] = await Promise.all([
      getTranslations({ locale }),
      getTranslations({ locale: 'en' }),
    ]);
    const buf = await renderPayslipPdf(
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
    );

    auditLog({
      actorId: user.id,
      action: 'payslip.preview',
      entityType: 'Payroll',
      entityId: `${employeeId}:${month}`,
      metadata: { source: 'admin-ui', month, employeeId },
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[payslip-preview-pdf] render failed', {
      employeeId,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
}
