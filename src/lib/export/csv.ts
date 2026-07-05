/** CSV writer — UTF-8 BOM (Excel/Windows assumes ANSI without it → Thai
 *  mojibake), RFC 4180 escaping, CRLF rows, raw numbers (machine-friendly). */
import type { ExportCell, ExportTable } from './export-table';

function field(v: ExportCell): string {
  let s = String(v);
  // Formula-injection guard: a text cell starting with = + - @ would execute
  // as a formula when the CSV is opened in Excel. Numbers stay raw.
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ExportTable): string {
  const lines: string[] = [];
  lines.push(table.columns.map((c) => field(c.label)).join(','));
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => field(row[c.key] ?? '')).join(','));
  }
  if (table.totals) {
    lines.push(table.columns.map((c) => field(table.totals?.[c.key] ?? '')).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}
