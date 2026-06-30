import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { payslipPeriodLabel, resolveLetterhead } from '@/lib/payslip/letterhead';
import { buildPreviewPayslipDocument } from '@/lib/payslip/preview';
import { buildPayslipHtml } from '@/lib/payslip/render-html';

/**
 * Admin draft-slip preview as HTML (not PDF).
 *
 * The modal preview only needs to LOOK like the slip — it doesn't need a real
 * PDF. Rendering the same markup as HTML skips Chromium entirely, so the
 * preview is near-instant, and the `screen` viewport makes the A4 sheet scale
 * to fit any frame (the iPad clipping problem). The actual download / published
 * slip still goes through the PDF path.
 */
export const runtime = 'nodejs';

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

  let doc: Awaited<ReturnType<typeof buildPreviewPayslipDocument>>;
  try {
    doc = await buildPreviewPayslipDocument(month, employeeId);
  } catch (err) {
    console.error('[payslip-preview-html] document build failed', {
      employeeId,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
  if (!doc) return new NextResponse('No computable draft', { status: 404 });

  const letterhead = await resolveLetterhead(doc.meta.letterhead);

  try {
    const locale = await getLocale();
    const [t, tEn] = await Promise.all([
      getTranslations({ locale }),
      getTranslations({ locale: 'en' }),
    ]);
    const html = buildPayslipHtml(doc, {
      locale,
      t: (k, v) => t(k as Parameters<typeof t>[0], v as Parameters<typeof t>[1]),
      tEn: (k) => tEn(k as Parameters<typeof tEn>[0]),
      money: (n) => formatMoney(n, locale as Locale),
      fontFace: fontFaceCss(locale),
      logoSvg: letterhead.logoHtml,
      companyEn: letterhead.companyEn,
      companyNative: letterhead.companyNative,
      periodLabel: payslipPeriodLabel(locale, month),
      generatedAt: new Date().toISOString(),
      screen: true,
    });

    auditLog({
      actorId: user.id,
      action: 'payslip.preview',
      entityType: 'Payroll',
      entityId: `${employeeId}:${month}`,
      metadata: { source: 'admin-ui', month, employeeId, format: 'html' },
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[payslip-preview-html] render failed', {
      employeeId,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
}
