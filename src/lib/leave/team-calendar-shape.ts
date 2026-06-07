/**
 * Pure shape + helpers for the team-calendar view.
 *
 * **Client-safe.** This file deliberately contains NO database imports
 * so it can be tree-shaken into Client Component bundles. The server-
 * only data loader lives in `team-calendar.ts` and imports types from
 * here.
 *
 * Split off from `team-calendar.ts` after a prod build leaked Prisma
 * into the client bundle (W5-deploy, 2026-05-27). Turbopack pulls the
 * whole module of any named import — so `import { indexEntriesByDate }`
 * from a file that also exported `getTeamCalendarData` dragged Prisma
 * along. Two-file split + `server-only` marker on the loader prevents
 * regression.
 */

export type TeamCalendarEntry = {
  leaveRequestId: string;
  employeeId: string;
  employeeName: string;
  /** Short label — nickname if present, else first name. Compact for grid cells. */
  shortLabel: string;
  leaveTypeName: string;
  status: 'Pending' | 'Approved';
  /** Inclusive YYYY-MM-DD range. */
  startDate: string;
  endDate: string;
  /** True when this is the viewer's own request. Used to highlight. */
  isMine: boolean;
};

export type TeamCalendarHoliday = {
  /** YYYY-MM-DD. */
  date: string;
  name: string;
};

export type TeamCalendarData = {
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
};

/** Format a UTC-midnight Date as YYYY-MM-DD. Inverse of parseInputDate. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Month math helpers ───────────────────────────────────────────────────

/** Parse `YYYY-MM` to UTC-midnight start/end of that month. Returns null on bad input. */
export function parseMonth(
  ym: string,
): { start: Date; end: Date; year: number; month0: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  const month0 = month1 - 1;
  const start = new Date(Date.UTC(year, month0, 1));
  // Day 0 of next month = last day of current month, at UTC midnight.
  const end = new Date(Date.UTC(year, month0 + 1, 0));
  return { start, end, year, month0 };
}

/** Current month in Bangkok time as YYYY-MM. */
export function currentMonthYM(): string {
  const ymdBkk = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return ymdBkk.slice(0, 7);
}

/** Step a YYYY-MM by ±1 month, returning YYYY-MM. */
export function shiftMonth(ym: string, delta: 1 | -1): string {
  const m = parseMonth(ym);
  if (!m) return ym;
  const next = new Date(Date.UTC(m.year, m.month0 + delta, 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}`;
}

/**
 * Build the 6×7 grid of dates for a calendar month, padded with leading
 * days from the previous month + trailing days from the next month so
 * the grid always renders as complete weeks. Week starts Sunday (Thai
 * convention — matches LINE itself and most domestic apps).
 *
 * Each cell carries the date + whether it's in the current month (for
 * styling out-of-month cells gray).
 */
export type GridDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** 1..31 day number for display. */
  day: number;
  /** True if this date belongs to the visible month. False for pre/post padding. */
  inMonth: boolean;
};

export function buildMonthGrid(year: number, month0: number): GridDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month0, 1));
  // getUTCDay: 0=Sun..6=Sat. Sunday-first grid means leading-pad = day-of-week.
  const leading = firstOfMonth.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month0, 1 - leading));

  const out: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000);
    out.push({
      date: ymd(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month0,
    });
  }
  return out;
}

/** Group entries by YYYY-MM-DD date covering every day in their range. */
export function indexEntriesByDate(entries: TeamCalendarEntry[]): Map<string, TeamCalendarEntry[]> {
  const idx = new Map<string, TeamCalendarEntry[]>();
  for (const e of entries) {
    const start = new Date(`${e.startDate}T00:00:00.000Z`);
    const end = new Date(`${e.endDate}T00:00:00.000Z`);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86_400_000)) {
      const key = ymd(d);
      const arr = idx.get(key);
      if (arr) arr.push(e);
      else idx.set(key, [e]);
    }
  }
  return idx;
}

// ─── Display helpers ───────────────────────────────────────────────────────

const THAI_MONTHS = [
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

/**
 * Header label like "มิถุนายน 2569" — Thai month name + Buddhist-calendar
 * year (Gregorian + 543). `month0` is 0-indexed (0 = January).
 */
export function formatThaiMonthLabel(year: number, month0: number): string {
  return `${THAI_MONTHS[month0]} ${year + 543}`;
}
