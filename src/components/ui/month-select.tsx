/**
 * Month dropdown — Thai month names + Buddhist year, value "YYYY-MM".
 *
 * Replaces `<input type="month">` in admin forms: the native control has no
 * picker on Safari desktop (renders as bare text) and always shows the
 * Gregorian year. A plain <select> works everywhere and reads naturally
 * ("กรกฎาคม 2569").
 *
 * Pure function of props (anchor month passed in, never `new Date()`), so
 * server and client render identically — no hydration drift at month
 * boundaries. Works in both Server and Client Components.
 */

const MONTH_TH = [
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

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelTh(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_TH[(m as number) - 1] ?? month} ${(y as number) + 543}`;
}

type Props = {
  id: string;
  name: string;
  /** Anchor month "YYYY-MM" the range is built around (pass from the server). */
  from: string;
  /** Months listed before the anchor (default 0). */
  back?: number;
  /** Months listed after the anchor (default 24). */
  forward?: number;
  defaultValue?: string;
  required?: boolean;
  className?: string;
};

export function MonthSelect({
  id,
  name,
  from,
  back = 0,
  forward = 24,
  defaultValue,
  required,
  className,
}: Props) {
  const months: string[] = [];
  for (let i = -back; i <= forward; i++) months.push(shiftMonth(from, i));
  // An edit form may carry a value outside the generated window (e.g. an
  // old startMonth) — include it so the current value never silently moves.
  if (defaultValue && !months.includes(defaultValue)) {
    months.push(defaultValue);
    months.sort();
  }

  return (
    <select
      id={id}
      name={name}
      required={required}
      defaultValue={defaultValue ?? from}
      className={`block rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500 ${className ?? ''}`}
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabelTh(m)}
        </option>
      ))}
    </select>
  );
}
