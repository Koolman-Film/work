import { describe, expect, it } from 'vitest';
import { deepMerge, getMessages } from './messages';

describe('deepMerge', () => {
  it('overlays later layers over earlier ones, recursively', () => {
    const base = { a: '1', nested: { x: 'th-x', y: 'th-y' } };
    const over = { nested: { y: 'en-y' } };
    expect(deepMerge(base, over)).toEqual({ a: '1', nested: { x: 'th-x', y: 'en-y' } });
  });

  it('does not mutate inputs', () => {
    const base = { nested: { x: '1' } };
    deepMerge(base, { nested: { x: '2' } });
    expect(base.nested.x).toBe('1');
  });
});

describe('getMessages', () => {
  it('returns an object containing the notifications namespace for every locale', () => {
    for (const loc of ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const) {
      const m = getMessages(loc) as Record<string, unknown>;
      expect(m.notifications).toBeTypeOf('object');
    }
  });

  it('falls back to English first for keys missing in an untranslated locale', () => {
    // km has no notifications keys yet → fallback chain target ← en ← th
    // resolves them to English (en overlays th), NOT Thai.
    const km = getMessages('km') as { notifications: { leaveApproved: { header: string } } };
    const en = getMessages('en') as { notifications: { leaveApproved: { header: string } } };
    expect(km.notifications.leaveApproved.header).toBe(en.notifications.leaveApproved.header);
  });

  it('uses Thai as the ultimate base (English overlays Thai for en)', () => {
    // Sanity: the en catalog itself is th-based with en overlaid, so a key
    // present in both comes from en.
    const en = getMessages('en') as { notifications: { leaveApproved: { header: string } } };
    expect(en.notifications.leaveApproved.header).toBe('Leave approved');
  });
});
