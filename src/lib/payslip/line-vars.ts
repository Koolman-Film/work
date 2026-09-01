/**
 * Resolves a `PayslipLine`'s i18n `vars` for one locale.
 *
 * `document.ts` builds the payslip with no locale awareness by design, so the
 * placeholders that depend on the reader — `{leaveType}` and `{date}` — are
 * carried as raw data on the line and resolved here. This lives in its own
 * module because BOTH renderers need it: the PDF (`render-html.ts`, which calls
 * it twice per line for the bilingual label) and the on-screen slip
 * (`/liff/payslip`). They had already drifted into two copies of the
 * leave-type half; one shared function keeps a new placeholder from having to
 * be added twice and remembered twice.
 */

import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import type { PayslipLine } from './types';

/**
 * "5 กันยายน 2569" for one day, "5 กันยายน 2569 – 7 กันยายน 2569" for a span.
 *
 * The LONG form, not `formatShortDate`, even though the line is tight: short
 * dates render `09/05/2026` in `en` and `05/09/2026` in Thai/Burmese/Khmer/Lao,
 * so a numeric date would be ambiguous on its own AND mean different things to
 * two people reading the same payslip in different languages. This line exists
 * to tell an employee which day they were charged for; it cannot be ambiguous
 * about the day.
 */
export function formatLeaveDates(dates: { start: string; end: string }, locale: Locale): string {
  const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`), locale);
  return dates.start === dates.end ? day(dates.start) : `${day(dates.start)} – ${day(dates.end)}`;
}

export function payslipLineVars(
  line: PayslipLine,
  locale: Locale,
): Record<string, string | number> | undefined {
  if (!line.leaveType && !line.dates) return line.vars;
  return {
    ...line.vars,
    ...(line.leaveType
      ? {
          leaveType: localizedLeaveTypeName(
            line.leaveType.name,
            line.leaveType.nameByLocale,
            locale,
          ),
        }
      : {}),
    ...(line.dates ? { date: formatLeaveDates(line.dates, locale) } : {}),
  };
}
