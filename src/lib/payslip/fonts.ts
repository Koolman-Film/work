// src/lib/payslip/fonts.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'src/lib/payslip/fonts');
const b64 = (f: string) => readFileSync(path.join(DIR, f)).toString('base64');
const face = (family: string, file: string, weight: number) =>
  `@font-face{font-family: '${family}';font-weight:${weight};font-style:normal;` +
  `src:url(data:font/ttf;base64,${b64(file)}) format('truetype');}`;

const SCRIPT: Record<string, { family: string; reg: string; bold: string }> = {
  th: { family: 'Noto Sans Thai', reg: 'NotoSansThai-Regular.ttf', bold: 'NotoSansThai-Bold.ttf' },
  lo: { family: 'Noto Sans Lao', reg: 'NotoSansLao-Regular.ttf', bold: 'NotoSansLao-Bold.ttf' },
  my: { family: 'Noto Sans Myanmar', reg: 'NotoSansMyanmar-Regular.ttf', bold: 'NotoSansMyanmar-Bold.ttf' },
  km: { family: 'Noto Sans Khmer', reg: 'NotoSansKhmer-Regular.ttf', bold: 'NotoSansKhmer-Bold.ttf' },
  'zh-CN': { family: 'Noto Sans SC', reg: 'NotoSansSC-Regular.ttf', bold: 'NotoSansSC-Bold.ttf' },
};

export const FONT_STACK =
  "'Noto Sans','Noto Sans Thai','Noto Sans Lao','Noto Sans Myanmar','Noto Sans Khmer','Noto Sans SC',sans-serif";

export function fontFaceCss(locale: string): string {
  const out = [face('Noto Sans', 'NotoSans-Regular.ttf', 400), face('Noto Sans', 'NotoSans-Bold.ttf', 700)];
  const s = SCRIPT[locale];
  if (s) { out.push(face(s.family, s.reg, 400), face(s.family, s.bold, 700)); }
  return out.join('\n');
}
