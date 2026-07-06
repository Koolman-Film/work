import { describe, expect, it } from 'vitest';
import {
  nextAnnounce,
  pickText,
  sortByDateDesc,
  tourById,
  unseenCount,
  unseenItems,
} from './selectors';
import type { LocalizedText, UpdateItem } from './types';

const items: UpdateItem[] = [
  { id: 'a', date: '2026-01-01', title: { th: 'A' }, body: { th: 'a' } },
  { id: 'b', date: '2026-03-01', title: { th: 'B' }, body: { th: 'b' }, announce: true },
  { id: 'c', date: '2026-02-01', title: { th: 'C' }, body: { th: 'c' }, announce: true },
];

describe('pickText', () => {
  it('returns the locale value when present', () => {
    expect(pickText({ th: 'สวัสดี', en: 'Hi' }, 'en')).toBe('Hi');
  });
  it('falls back to th when the locale value is missing', () => {
    expect(pickText({ th: 'สวัสดี' }, 'en')).toBe('สวัสดี');
  });
  it('returns the th value for the th locale', () => {
    expect(pickText({ th: 'สวัสดี', en: 'Hi' }, 'th')).toBe('สวัสดี');
  });

  it('resolves each non-Thai locale when present', () => {
    const t: LocalizedText = {
      th: 'ไทย',
      en: 'English',
      my: 'မြန်မာ',
      lo: 'ລາວ',
      'zh-CN': '简体中文',
      km: 'ខ្មែរ',
    };
    expect(pickText(t, 'my')).toBe('မြန်မာ');
    expect(pickText(t, 'lo')).toBe('ລາວ');
    expect(pickText(t, 'zh-CN')).toBe('简体中文');
    expect(pickText(t, 'km')).toBe('ខ្មែរ');
  });

  it('falls back to th when the requested locale key is absent', () => {
    const t: LocalizedText = { th: 'ไทย', en: 'English' };
    expect(pickText(t, 'my')).toBe('ไทย');
    expect(pickText(t, 'km')).toBe('ไทย');
  });
});

describe('sortByDateDesc', () => {
  it('orders newest first and does not mutate input', () => {
    const out = sortByDateDesc(items);
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('unseenItems / unseenCount', () => {
  it('excludes ids in the seen set', () => {
    const seen = new Set(['a', 'b']);
    expect(unseenItems(items, seen).map((i) => i.id)).toEqual(['c']);
    expect(unseenCount(items, seen)).toBe(1);
  });
  it('returns remaining unseen items newest-first', () => {
    expect(unseenItems(items, new Set(['b'])).map((i) => i.id)).toEqual(['c', 'a']);
  });
  it('treats an empty seen set as everything unseen', () => {
    expect(unseenCount(items, new Set())).toBe(3);
  });
  it('counts zero when everything is seen', () => {
    expect(unseenCount(items, new Set(['a', 'b', 'c']))).toBe(0);
  });
});

describe('nextAnnounce', () => {
  it('returns the newest unseen item flagged announce', () => {
    expect(nextAnnounce(items, new Set())?.id).toBe('b');
  });
  it('skips seen announce items', () => {
    expect(nextAnnounce(items, new Set(['b']))?.id).toBe('c');
  });
  it('returns null when no unseen announce item remains', () => {
    expect(nextAnnounce(items, new Set(['b', 'c']))).toBeNull();
  });
});

describe('tourById', () => {
  it('finds a tour by id and returns null when absent', () => {
    const tours = [{ id: 'welcome', steps: [] }];
    expect(tourById(tours, 'welcome')?.id).toBe('welcome');
    expect(tourById(tours, 'nope')).toBeNull();
  });
});
