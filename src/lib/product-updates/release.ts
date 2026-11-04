/**
 * Release numbering and figure geometry — pure, so the registry guards and the
 * components share one definition.
 *
 * Version = `YYYY.MM.N`: the year and month of the release date, then a count
 * of releases in that month starting at 1. A release is what we ANNOUNCE, not a
 * deploy — several deploys roll into one release. Calendar-based because the
 * readers are payroll admins who think in months, and because it needs no
 * "is this major?" judgment the way semantic versions do.
 */
import type { TimelineFigure, UpdateItem } from './types';

const VERSION_RE = /^(\d{4})\.(0[1-9]|1[0-2])\.([1-9]\d*)$/;

export type ParsedVersion = { year: number; month: number; n: number };

export function parseVersion(v: string): ParsedVersion | null {
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), n: Number(m[3]) };
}

/** Negative when `a` is older. Invalid versions sort last-oldest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  return pa.year - pb.year || pa.month - pb.month || pa.n - pb.n;
}

/** Newest first. Returns a new array. */
export function sortReleasesDesc(items: readonly UpdateItem[]): UpdateItem[] {
  return [...items].sort((a, b) => compareVersions(b.version, a.version));
}

export function latestRelease(items: readonly UpdateItem[]): UpdateItem | null {
  return sortReleasesDesc(items)[0] ?? null;
}

/** "2026.11.1" → "v2026-11-1": an id usable as an HTML anchor. */
export function versionAnchor(v: string): string {
  return `v${v.replace(/\./g, '-')}`;
}

/**
 * Every rule a registry must keep, as messages; [] when it keeps them all.
 * Lives here, not only in a test, so the guide can point at one definition.
 */
export function versionProblems(items: readonly UpdateItem[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const byMonth = new Map<string, UpdateItem[]>();
  for (const item of items) {
    const p = parseVersion(item.version);
    if (!p) {
      problems.push(`${item.id}: version "${item.version}" is not YYYY.MM.N`);
      continue;
    }
    if (seen.has(item.version)) problems.push(`${item.id}: version ${item.version} is used twice`);
    seen.add(item.version);
    const ym = `${p.year}-${String(p.month).padStart(2, '0')}`;
    if (item.date.slice(0, 7) !== ym) {
      problems.push(`${item.id}: version ${item.version} does not match its date ${item.date}`);
    }
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), item]);
  }
  for (const [ym, list] of byMonth) {
    const ordered = [...list].sort((a, b) => compareVersions(a.version, b.version));
    ordered.forEach((item, i) => {
      if (parseVersion(item.version)?.n !== i + 1) {
        problems.push(`${ym}: releases must count 1, 2, 3… — ${item.version} is out of sequence`);
      }
      const prev = ordered[i - 1];
      if (prev && prev.date > item.date) {
        problems.push(`${item.version} is dated before ${prev.version}`);
      }
    });
  }
  return problems;
}

const DAY = 86_400_000;
const day = (ymd: string) => Date.parse(`${ymd}T00:00:00.000Z`);

export type TimelineBar = {
  /** Percent of the track, 0–100. */
  left: number;
  width: number;
  tone: 'muted' | 'brand' | 'highlight';
  /** The payroll month the bar belongs to: the month of its `to` date. */
  month: string;
  note?: TimelineFigure['rows'][number]['segments'][number]['note'];
  from: string;
  to: string;
};

/** Bar geometry on one inclusive day scale, so every row is comparable. */
export function timelineLayout(fig: TimelineFigure): {
  rows: { label: TimelineFigure['rows'][number]['label']; bars: TimelineBar[] }[];
  ticks: { ymd: string; left: number }[];
} {
  const start = day(fig.from);
  const span = (day(fig.to) - start) / DAY + 1;
  const pct = (ymd: string) => (((day(ymd) - start) / DAY) * 100) / span;
  const rows = fig.rows.map((r) => ({
    label: r.label,
    bars: r.segments.map((s) => ({
      left: pct(s.from),
      width: pct(s.to) - pct(s.from) + 100 / span,
      tone: s.tone,
      month: s.to.slice(0, 7),
      note: s.note,
      from: s.from,
      to: s.to,
    })),
  }));
  // A tick on the 1st of every month inside the range.
  const ticks: { ymd: string; left: number }[] = [];
  const d = new Date(start);
  d.setUTCDate(1);
  if (d.getTime() < start) d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() <= day(fig.to)) {
    const ymd = d.toISOString().slice(0, 10);
    ticks.push({ ymd, left: pct(ymd) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return { rows, ticks };
}
