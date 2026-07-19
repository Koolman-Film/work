/**
 * URL builders for the summary period picker.
 *
 * Pure and separate from the component so the link shapes are unit-testable
 * without rendering. The server re-validates everything in
 * `resolveReportPeriod` — `rangeUrl` returning null just avoids navigating
 * to a URL we already know the server would discard back to month mode.
 */

const BASE = '/liff/summary';

export function monthUrl(ym: string): string {
  return `${BASE}?m=${ym}`;
}

/** null when the range is incomplete or inverted — caller should not navigate. */
export function rangeUrl(from: string, to: string): string | null {
  if (!from || !to) return null;
  if (from > to) return null; // YYYY-MM-DD sorts lexicographically
  return `${BASE}?from=${from}&to=${to}`;
}
