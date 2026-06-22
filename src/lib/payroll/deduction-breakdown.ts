/**
 * Pure helper: split a Payroll row's combined "หักอื่น" figure into its
 * labelled, non-zero parts so the UI can show WHY a deduction total is what it
 * is (e.g. "เบิก 9,200 · ขาด/สาย 500"). SSO is shown in its own column, so it's
 * intentionally excluded here.
 *
 * Client-safe (no DB) — used by both the admin payroll table and the worker
 * payslip.
 */

export type DeductionParts = {
  advance: number;
  attendance: number;
  leave: number;
  debt: number;
  other: number;
};

export type DeductionLine = { label: string; amount: number };

/** Order + Thai labels for each bucket. `attendance` lumps absent/late/early
 *  (the stored figure isn't split), hence the slash label. */
const BUCKETS: ReadonlyArray<{ key: keyof DeductionParts; label: string }> = [
  { key: 'advance', label: 'เบิก' },
  { key: 'attendance', label: 'ขาด/สาย' },
  { key: 'leave', label: 'ลา' },
  { key: 'debt', label: 'ผ่อน/หนี้' },
  { key: 'other', label: 'อื่นๆ' },
];

/** Non-zero deduction parts, in display order. */
export function deductionBreakdown(parts: DeductionParts): DeductionLine[] {
  return BUCKETS.filter((b) => parts[b.key] > 0).map((b) => ({
    label: b.label,
    amount: parts[b.key],
  }));
}

/** Compact one-line summary, e.g. "เบิก 9,200 · ขาด/สาย 500" (no ฿, no decimals). */
export function deductionBreakdownLabel(lines: DeductionLine[]): string {
  return lines.map((l) => `${l.label} ${l.amount.toLocaleString('th-TH')}`).join(' · ');
}
