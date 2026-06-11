/**
 * Shared export model — every report maps its query rows to ExportTable
 * once; the csv/xlsx/pdf writers all consume this shape. Pure (no DB).
 */
import { formatTHB2 } from '@/lib/format';
import type { ReportPeriod } from '@/lib/reports/period';

export type CellFormat = 'text' | 'int' | 'thb';

export type ExportColumn = {
  key: string;
  label: string; // Thai header, mirrors on-screen table
  align?: 'left' | 'right';
  format?: CellFormat; // default 'text'
};

export type ExportCell = string | number;

export type ExportTable = {
  title: string; // Thai report title
  periodLabel: string; // Buddhist-era label, see thaiPeriodLabel
  generatedAt: string; // pre-formatted Bangkok timestamp
  columns: ExportColumn[];
  rows: Record<string, ExportCell>[];
  /** Footer totals keyed by column key; first column shows "รวม N คน". */
  totals?: Record<string, ExportCell>;
};

const thaiShort = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC', // labels format UTC-midnight YMD dates, not instants
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Cached formatter for the month-only branch of thaiPeriodLabel. */
const thaiMonthShort = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'short' });

function thaiYmd(ymd: string): string {
  return thaiShort.format(new Date(`${ymd}T00:00:00.000Z`));
}

/** "มิ.ย. 2569" (month mode) or "1 มิ.ย. 2569 – 15 มิ.ย. 2569" (range). */
export function thaiPeriodLabel(period: ReportPeriod): string {
  if (period.month) {
    const y = Number(period.month.slice(0, 4)) + 543;
    const m = thaiMonthShort.format(new Date(`${period.month}-01T00:00:00Z`));
    return `${m} ${y}`;
  }
  return `${thaiYmd(period.from)} – ${thaiYmd(period.to)}`;
}

/** Bangkok-tz "11 มิ.ย. 2569 14:30" stamp for the generated-at line. */
export function generatedAtLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

export function exportFilename(
  title: string,
  period: ReportPeriod,
  ext: 'pdf' | 'xlsx' | 'csv',
): string {
  const suffix = period.month ?? `${period.from}_${period.to}`;
  return `${title}-${suffix}.${ext}`;
}

/** Display string for a cell — used by the PDF template. CSV keeps raw
 *  numbers; xlsx uses numFmt instead. */
export function formatCellDisplay(value: ExportCell, format: CellFormat = 'text'): string {
  // String values are already display-ready; format is ignored.
  if (typeof value === 'string') return value;
  if (format === 'thb') return formatTHB2(value);
  return value.toLocaleString('th-TH');
}
