import { describe, expect, it } from 'vitest';
import { buildPageMeta, PAGE_SIZE, pageArgs, parsePageParam } from './pagination';

describe('parsePageParam', () => {
  it('parses a valid 1-based page', () => {
    expect(parsePageParam('3')).toBe(3);
  });

  it('clamps anything missing / non-numeric / < 1 to page 1', () => {
    for (const raw of [undefined, '', 'abc', '0', '-2', '1.5e-9']) {
      expect(parsePageParam(raw)).toBe(1);
    }
  });

  it('floors fractional input', () => {
    expect(parsePageParam('2.9')).toBe(2);
  });
});

describe('pageArgs', () => {
  it('offsets by (page - 1) * size', () => {
    expect(pageArgs(1, 20)).toEqual({ skip: 0, take: 20 });
    expect(pageArgs(3, 20)).toEqual({ skip: 40, take: 20 });
  });

  it('defaults to PAGE_SIZE', () => {
    expect(pageArgs(2)).toEqual({ skip: PAGE_SIZE, take: PAGE_SIZE });
  });
});

describe('buildPageMeta', () => {
  it('computes page count, window, and nav flags for a middle page', () => {
    const m = buildPageMeta(45, 2, 20);
    expect(m).toMatchObject({
      page: 2,
      pageCount: 3,
      total: 45,
      pageSize: 20,
      hasPrev: true,
      hasNext: true,
      from: 21,
      to: 40,
    });
  });

  it('caps `to` at the total on the last (partial) page', () => {
    const m = buildPageMeta(45, 3, 20);
    expect(m).toMatchObject({ page: 3, from: 41, to: 45, hasNext: false });
  });

  it('clamps an over-the-end requested page down to the last page', () => {
    const m = buildPageMeta(45, 99, 20);
    expect(m.page).toBe(3);
    expect(m.pageCount).toBe(3);
    expect(m.hasNext).toBe(false);
  });

  it('reports a single empty page (never "page 0 of 0") for no rows', () => {
    const m = buildPageMeta(0, 1, 20);
    expect(m).toMatchObject({
      page: 1,
      pageCount: 1,
      total: 0,
      hasPrev: false,
      hasNext: false,
      from: 0,
      to: 0,
    });
  });
});
