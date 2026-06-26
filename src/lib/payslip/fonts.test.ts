// src/lib/payslip/fonts.test.ts
import { describe, expect, it } from 'vitest';
import { fontFaceCss } from './fonts';

describe('fontFaceCss', () => {
  it('always includes Noto Sans (Latin) as base64', () => {
    expect(fontFaceCss('en')).toContain("font-family: 'Noto Sans'");
    expect(fontFaceCss('en')).toContain('data:font/ttf;base64,');
  });
  it('includes the Thai font for th but not the CJK font', () => {
    const css = fontFaceCss('th');
    expect(css).toContain("font-family: 'Noto Sans Thai'");
    expect(css).not.toContain("font-family: 'Noto Sans SC'");
  });
  it('includes the CJK font only for zh-CN', () => {
    expect(fontFaceCss('zh-CN')).toContain("font-family: 'Noto Sans SC'");
    expect(fontFaceCss('km')).not.toContain("font-family: 'Noto Sans SC'");
  });
  it('ALWAYS embeds Thai (company name + Thai data appears on every locale)', () => {
    // Thai is the company's data language; it must render on Vercel (no system fonts).
    expect(fontFaceCss('en')).toContain("font-family: 'Noto Sans Thai'");
    expect(fontFaceCss('km')).toContain("font-family: 'Noto Sans Thai'");
    expect(fontFaceCss('zh-CN')).toContain("font-family: 'Noto Sans Thai'");
  });
  it('adds the viewer locale script on top of Latin+Thai', () => {
    expect(fontFaceCss('km')).toContain("font-family: 'Noto Sans Khmer'");
    expect(fontFaceCss('my')).toContain("font-family: 'Noto Sans Myanmar'");
  });
});
