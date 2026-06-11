/**
 * Small, pure display formatters shared across the redesigned UI.
 *
 * Kept here (not inline at call sites) so money, dates, and avatar initials
 * read identically on every page. All return display strings — never parse
 * with these.
 */

const thb = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const thaiShortDate = new Intl.DateTimeFormat('th-TH', {
  // Pin Bangkok — without it, formatting uses the server's timezone, so on a
  // UTC runtime (Vercel) a date near midnight renders the previous day. The
  // whole app operates on the Bangkok calendar day.
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "฿5,000" — tabular-friendly THB money, no decimals (rounds to whole baht). */
export function formatTHB(amount: number): string {
  return `฿${thb.format(Math.round(amount))}`;
}

/** "฿5,000.00" — THB money with exactly two decimals (satang). Both fraction
 *  bounds pinned: minimum alone would let Intl print 3+ decimals on computed
 *  sums. Used by the admin report tables. */
export function formatTHB2(amount: number): string {
  return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** First two characters of a name/email, uppercased — for `Avatar` initials. */
export function initials(label: string): string {
  return label.trim().slice(0, 2).toUpperCase();
}

/** Short Thai date in the Buddhist era — e.g. "1 มิ.ย. 2569". */
export function formatThaiDate(date: Date): string {
  return thaiShortDate.format(date);
}

const MONTH_TH_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** "YYYY-MM" → "มิถุนายน 2569" (Buddhist year). Returns input unchanged when unparseable. */
export function monthLabelTh(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_TH_FULL[(m as number) - 1] ?? month} ${(y as number) + 543}`;
}
