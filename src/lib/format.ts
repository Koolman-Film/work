/**
 * Small, pure display formatters shared across the redesigned UI.
 *
 * Kept here (not inline at call sites) so money, dates, and avatar initials
 * read identically on every page. All return display strings — never parse
 * with these.
 */

const thb = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const thaiShortDate = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "฿5,000" — tabular-friendly THB money, no decimals (rounds to whole baht). */
export function formatTHB(amount: number): string {
  return `฿${thb.format(Math.round(amount))}`;
}

/** First two characters of a name/email, uppercased — for `Avatar` initials. */
export function initials(label: string): string {
  return label.trim().slice(0, 2).toUpperCase();
}

/** Short Thai date in the Buddhist era — e.g. "1 มิ.ย. 2569". */
export function formatThaiDate(date: Date): string {
  return thaiShortDate.format(date);
}
