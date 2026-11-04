import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  latestRelease,
  parseVersion,
  timelineLayout,
  versionAnchor,
  versionProblems,
} from './release';
import type { TimelineFigure, UpdateItem } from './types';

const item = (id: string, version: string, date: string): UpdateItem => ({
  id,
  version,
  date,
  title: { th: id },
  summary: { th: id },
});

describe('version numbers', () => {
  it('parses YYYY.MM.N and rejects anything else', () => {
    expect(parseVersion('2026.11.1')).toEqual({ year: 2026, month: 11, n: 1 });
    for (const bad of ['2026.11', '2026.1.1', '2026.13.1', '2026.11.0', 'v2026.11.1', '1.4.2']) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });

  it('compares numerically, not as strings', () => {
    expect(compareVersions('2026.11.10', '2026.11.9')).toBeGreaterThan(0);
    expect(compareVersions('2026.09.2', '2026.11.1')).toBeLessThan(0);
    expect(compareVersions('2027.01.1', '2026.12.3')).toBeGreaterThan(0);
  });

  it('latestRelease is the highest version, whatever the file order', () => {
    const items = [item('a', '2026.09.1', '2026-09-02'), item('b', '2026.11.1', '2026-11-04')];
    expect(latestRelease(items)?.id).toBe('b');
    expect(latestRelease([])).toBeNull();
  });

  it('anchors are hash-safe', () => {
    expect(versionAnchor('2026.11.1')).toBe('v2026-11-1');
  });
});

describe('versionProblems', () => {
  it('passes a well-formed registry', () => {
    expect(
      versionProblems([
        item('a', '2026.09.1', '2026-09-02'),
        item('b', '2026.09.2', '2026-09-06'),
        item('c', '2026.11.1', '2026-11-04'),
      ]),
    ).toEqual([]);
  });

  it('flags a version whose month does not match its date', () => {
    expect(versionProblems([item('a', '2026.11.1', '2026-10-30')])[0]).toMatch(/does not match/);
  });

  it('flags a gap or a repeat in the month count', () => {
    expect(versionProblems([item('a', '2026.11.2', '2026-11-04')]).join()).toMatch(/sequence/);
    expect(
      versionProblems([
        item('a', '2026.11.1', '2026-11-04'),
        item('b', '2026.11.1', '2026-11-05'),
      ]).join(),
    ).toMatch(/twice/);
  });

  it('flags a later count dated earlier', () => {
    expect(
      versionProblems([
        item('a', '2026.11.1', '2026-11-10'),
        item('b', '2026.11.2', '2026-11-04'),
      ]).join(),
    ).toMatch(/dated before/);
  });
});

describe('timelineLayout', () => {
  const fig: TimelineFigure = {
    kind: 'timeline',
    from: '2026-09-27',
    to: '2026-12-31',
    rows: [
      {
        label: { th: 'x' },
        segments: [
          { from: '2026-09-27', to: '2026-10-31', tone: 'highlight' },
          { from: '2026-11-01', to: '2026-11-30', tone: 'brand' },
          { from: '2026-12-01', to: '2026-12-31', tone: 'brand' },
        ],
      },
    ],
  };

  it('bars that cover the range end to end fill exactly 100%', () => {
    const { rows } = timelineLayout(fig);
    const bars = rows[0]?.bars ?? [];
    expect(bars[0]?.left).toBe(0);
    const total = bars.reduce((s, b) => s + b.width, 0);
    expect(total).toBeCloseTo(100, 6);
    // Contiguous: each bar starts where the previous one ends.
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]?.left).toBeCloseTo((bars[i - 1]?.left ?? 0) + (bars[i - 1]?.width ?? 0), 6);
    }
  });

  it('labels each bar with the payroll month of its end date', () => {
    expect(timelineLayout(fig).rows[0]?.bars.map((b) => b.month)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('ticks the 1st of each month inside the range', () => {
    expect(timelineLayout(fig).ticks.map((t) => t.ymd)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);
  });
});
