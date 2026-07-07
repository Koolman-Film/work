import { formatThaiDate } from '@/lib/format';
import { fieldLabel } from './labels';

export type DiffRow = {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

const num = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

/** Render a JSON scalar/array/object as a human-readable display string. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่ใช่';
  if (typeof v === 'number') return num.format(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return formatThaiDate(v);
  return JSON.stringify(v);
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Field-by-field diff over the union of keys in before/after, sorted by key. */
export function diffValues(before: unknown, after: unknown): DiffRow[] {
  const b = toRecord(before);
  const a = toRecord(after);
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  return keys.map((field) => {
    const beforeStr = formatValue(b[field]);
    const afterStr = formatValue(a[field]);
    return {
      field,
      label: fieldLabel(field),
      before: beforeStr,
      after: afterStr,
      changed: beforeStr !== afterStr,
    };
  });
}
