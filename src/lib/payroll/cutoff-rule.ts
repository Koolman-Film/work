/**
 * Payroll cut-off rules — which days a payroll month ("YYYY-MM") covers.
 *
 * The company cut-off (`PayrollConfig.cutoffDay`, 1–28) applies to everyone
 * unless the employee's HOME branch has an override. Overrides are a history,
 * not a single value: each one says "from this month on, this branch cuts on
 * day N" (N = 1–28, or END_OF_MONTH). A month uses the latest override whose
 * `fromMonth` is on or before it, else the company day. Keeping the history is
 * what makes a later change forward-only — replacing a single stored value
 * would silently re-window every month the old value covered, including ones
 * already paid.
 *
 * A month's window is (previous month's end + 1) .. (this month's end), where
 * each month's end comes from the rule that month uses. So a switch-over month
 * is stretched or shortened automatically and windows are always contiguous —
 * no day is ever on zero payslips or on two. Central Audio's move from the 26th
 * to month-end from 2026-10 gives 2026-10 = 27 Sep .. 31 Oct.
 *
 * Pure UTC day arithmetic on YYYY-MM-DD strings; no wall clock.
 */

/** Stored cut-off value meaning "the last day of the month". */
export const END_OF_MONTH = 31;

export type BranchCutoff = { cutoffDay: number; fromMonth: string };
export type CutoffRule = { globalCutoffDay: number; overrides: readonly BranchCutoff[] };
/** A plain number is the company day with no overrides (the pre-override API). */
export type Cutoff = number | CutoffRule;

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBranchCutoffDay(n: number): boolean {
  return Number.isInteger(n) && ((n >= 1 && n <= 28) || n === END_OF_MONTH);
}

export function isValidMonth(ym: string): boolean {
  return YM.test(ym);
}

export function toRule(c: Cutoff): CutoffRule {
  const rule = typeof c === 'number' ? { globalCutoffDay: c, overrides: [] } : c;
  const g = rule.globalCutoffDay;
  if (!Number.isInteger(g) || g < 1 || g > 28)
    throw new Error(`cutoff rule: company cutoffDay must be 1–28, got ${g}`);
  for (const o of rule.overrides) {
    if (!isValidBranchCutoffDay(o.cutoffDay))
      throw new Error(`cutoff rule: branch cutoffDay must be 1–28 or 31, got ${o.cutoffDay}`);
    if (!YM.test(o.fromMonth)) throw new Error(`cutoff rule: invalid fromMonth '${o.fromMonth}'`);
  }
  return rule;
}

function splitYm(month: string): [number, number] {
  if (!YM.test(month)) throw new Error(`cutoff rule: invalid month '${month}'`);
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = splitYm(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ruleDay(month: string, rule: CutoffRule): number {
  let best: BranchCutoff | null = null;
  for (const o of rule.overrides) {
    // YYYY-MM strings compare correctly as strings.
    if (o.fromMonth <= month && (!best || o.fromMonth > best.fromMonth)) best = o;
  }
  return best ? best.cutoffDay : rule.globalCutoffDay;
}

/** The cut-off day value in force for `month` (END_OF_MONTH, or 1–28). */
export function cutoffDayForMonth(month: string, c: Cutoff): number {
  splitYm(month);
  return ruleDay(month, toRule(c));
}

/** Inclusive last day (YYYY-MM-DD) of `month`'s payroll window. */
function monthEnd(month: string, rule: CutoffRule): string {
  const [y, m] = splitYm(month);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(ruleDay(month, rule), daysInMonth);
  return ymd(new Date(Date.UTC(y, m - 1, day)));
}

function nextDay(s: string): string {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

/** Inclusive YYYY-MM-DD window of payroll month `month`. */
export function periodWindowYmd(month: string, c: Cutoff): { from: string; to: string } {
  const rule = toRule(c);
  return { from: nextDay(monthEnd(shiftMonth(month, -1), rule)), to: monthEnd(month, rule) };
}

/** The payroll month whose window contains `date` (YYYY-MM-DD), with its bounds. */
export function periodContaining(
  date: string,
  c: Cutoff,
): { start: string; end: string; month: string } {
  if (!YMD.test(date)) throw new Error(`cutoff rule: invalid date '${date}'`);
  const rule = toRule(c);
  // A window always ends in its own month and starts at most one month
  // earlier, so the containing month is the date's month or the next one.
  const own = date.slice(0, 7);
  const month = date <= monthEnd(own, rule) ? own : shiftMonth(own, 1);
  const { from, to } = periodWindowYmd(month, rule);
  return { start: from, end: to, month };
}

/**
 * Do two rules give identical windows for every month from `month` on? Used to
 * refuse moving an employee between branches whose cut-offs differ once they
 * have been paid: the window follows the CURRENT home branch, so a move would
 * re-window their paid payslips and put days on two payslips or on none.
 */
export function rulesAgreeFrom(month: string, a: Cutoff, b: Cutoff): boolean {
  const ra = toRule(a);
  const rb = toRule(b);
  // A month's window also depends on the previous month's end. After the last
  // override in either rule both are constant, so checking up to it suffices.
  let last = month;
  for (const o of [...ra.overrides, ...rb.overrides]) if (o.fromMonth > last) last = o.fromMonth;
  for (let m = shiftMonth(month, -1); m <= last; m = shiftMonth(m, 1)) {
    if (ruleDay(m, ra) !== ruleDay(m, rb)) return false;
  }
  return true;
}

/** Thai label for a cut-off value, e.g. "วันที่ 26" or "สิ้นเดือน". */
export function describeCutoffDay(n: number): string {
  return n === END_OF_MONTH ? 'สิ้นเดือน' : `วันที่ ${n}`;
}
