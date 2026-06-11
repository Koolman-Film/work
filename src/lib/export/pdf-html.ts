/**
 * Standalone HTML for the PDF — inline Sapphire tokens (not app CSS, so
 * no Tailwind runtime in the lambda). IBM Plex Thai embedded as base64
 * @font-face: lambda images ship no Thai system fonts.
 */
import { type ExportTable, formatCellDisplay } from './export-table';

export type PdfFonts = { regularB64: string; boldB64: string };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPdfHtml(table: ExportTable, fonts: PdfFonts): string {
  const ths = table.columns
    .map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`)
    .join('');
  const trs = table.rows
    .map(
      (row) =>
        `<tr>${table.columns
          .map(
            (c) =>
              `<td class="${c.align === 'right' ? 'r' : ''}">${esc(formatCellDisplay(row[c.key] ?? '', c.format))}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const tfoot = table.totals
    ? `<tfoot><tr>${table.columns
        .map(
          (c) =>
            `<td class="${c.align === 'right' ? 'r' : ''}">${esc(formatCellDisplay(table.totals?.[c.key] ?? '', c.format))}</td>`,
        )
        .join('')}</tr></tfoot>`
    : '';

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<style>
@font-face { font-family: 'IBM Plex Sans Thai'; font-weight: 400;
  src: url(data:font/ttf;base64,${fonts.regularB64}) format('truetype'); }
@font-face { font-family: 'IBM Plex Sans Thai'; font-weight: 700;
  src: url(data:font/ttf;base64,${fonts.boldB64}) format('truetype'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'IBM Plex Sans Thai', sans-serif; color: #0f172a; font-size: 9pt; line-height: 1.65; }
.band { background: #3955e8; color: #fff; padding: 14px 18px; border-radius: 8px; margin-bottom: 12px; }
.band h1 { font-size: 15pt; font-weight: 700; letter-spacing: -0.015em; }
.band .meta { font-size: 8pt; opacity: .85; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
thead th { background: #f1f5f9; color: #475569; font-size: 7.5pt; font-weight: 700;
  text-align: left; padding: 6px 8px; border-bottom: 1.5px solid #cbd5e1; }
tbody td { padding: 5px 8px; border-bottom: 0.5px solid #e2e8f0; }
tbody tr:nth-child(even) td { background: #f8fafc; }
tfoot td { background: #f1f5f9; font-weight: 700; padding: 6px 8px; border-top: 1.5px solid #cbd5e1; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
</style></head>
<body>
<div class="band">
  <h1>${esc(table.title)}</h1>
  <div class="meta">ช่วงเวลา: ${esc(table.periodLabel)} • สร้างเมื่อ ${esc(table.generatedAt)}</div>
</div>
<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>${tfoot}</table>
</body></html>`;
}
