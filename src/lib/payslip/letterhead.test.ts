import { describe, expect, it, vi } from 'vitest';
import { payslipPeriodLabel } from './letterhead';

const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ storage: { from: () => ({ download }) } }),
}));

import { resolveLetterhead } from './letterhead';

describe('payslipPeriodLabel', () => {
  it('uses the Buddhist year (+543) for Thai', () => {
    expect(payslipPeriodLabel('th', '2026-06')).toBe('มิถุนายน 2569');
  });

  it('computes the Buddhist year dynamically (not hardcoded)', () => {
    expect(payslipPeriodLabel('th', '2025-06')).toBe('มิถุนายน 2568');
  });

  it('uses the Gregorian year for English', () => {
    expect(payslipPeriodLabel('en', '2026-06')).toBe('June 2026');
  });

  it('localizes month + year for other scripts', () => {
    expect(payslipPeriodLabel('zh-CN', '2026-06')).toBe('2026年6月');
    expect(payslipPeriodLabel('lo', '2026-06')).toBe('ມິຖຸນາ 2026');
  });

  it('does not roll the month over (uses day 01, UTC)', () => {
    expect(payslipPeriodLabel('en', '2026-12')).toBe('December 2026');
    expect(payslipPeriodLabel('th', '2026-01')).toBe('มกราคม 2569');
  });
});

describe('resolveLetterhead', () => {
  it('uses Koolman defaults + the SVG logo when all fields are null', async () => {
    const r = await resolveLetterhead({ payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null });
    expect(r.companyEn).toBe('Koolman Co., Ltd.');
    expect(r.companyNative).toBe('บริษัท คูลแมน จำกัด');
    expect(r.logoHtml).toContain('<svg');
    expect(download).not.toHaveBeenCalled();
  });

  it('overrides names and embeds the logo as a base64 img when set', async () => {
    download.mockResolvedValueOnce({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    const r = await resolveLetterhead({
      payslipNameEn: 'Acme Co., Ltd.',
      payslipNameNative: 'บริษัท แอคมี จำกัด',
      payslipLogoKey: 'admin-1/branch-logos/b1.png',
    });
    expect(r.companyEn).toBe('Acme Co., Ltd.');
    expect(r.logoHtml).toContain('data:image/png;base64,');
    expect(r.logoHtml).toContain('<img');
  });

  it('falls back to the SVG logo when the download fails', async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const r = await resolveLetterhead({ payslipNameEn: null, payslipNameNative: null, payslipLogoKey: 'missing.png' });
    expect(r.logoHtml).toContain('<svg');
  });
});
