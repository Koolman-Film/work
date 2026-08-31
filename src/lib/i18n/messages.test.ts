import { describe, expect, it } from 'vitest';
import enMessages from '../../../messages/en.json';
import kmMessages from '../../../messages/km.json';
import loMessages from '../../../messages/lo.json';
import myMessages from '../../../messages/my.json';
import thMessages from '../../../messages/th.json';
import zhMessages from '../../../messages/zh-CN.json';
import { deepMerge, getMessages } from './messages';

/** Collect every leaf key path (dot-joined) from a nested message object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

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

describe('liffAdmin namespace', () => {
  const th = (thMessages as Record<string, unknown>).liffAdmin as Record<string, unknown>;
  const en = (enMessages as Record<string, unknown>).liffAdmin as Record<string, unknown>;

  it('exists in both the Thai (source) and English catalogs', () => {
    expect(th).toBeTypeOf('object');
    expect(en).toBeTypeOf('object');
  });

  it('has identical key structure in th and en (no half-translated keys)', () => {
    // The admin LIFF pages are fully localized: every Thai source key must
    // have an English counterpart so the switcher actually changes the text.
    // The 4 stub locales inherit English via the th ← en ← target fallback.
    const thKeys = keyPaths(th).sort();
    const enKeys = keyPaths(en).sort();
    expect(enKeys).toEqual(thKeys);
  });
});

describe('locale catalogs', () => {
  // Measured 2026-08-31: th 579 keys (source), en 579 (100%), and my / lo /
  // zh-CN / km 415 each — the SAME 415. The four are deliberately partial
  // stubs covering the employee-facing surfaces; everything else reaches them
  // through the target ← English ← Thai fallback in getMessages.
  //
  // So full six-way parity is NOT the invariant. Demanding it would require 164
  // translations x 4 languages that the design deliberately does not want, and
  // the test would fail on day one.
  //
  // What IS worth protecting is that the four stubs stay identical to EACH
  // OTHER. Add a key to `my` and forget `lo`, and a Lao worker silently sees
  // English on a screen a Burmese worker sees translated — nothing fails, and
  // the fallback makes it invisible. That is real drift, and this is the only
  // thing watching for it.
  const STUBS: Array<{ loc: string; msgs: Record<string, unknown> }> = [
    { loc: 'my', msgs: myMessages as Record<string, unknown> },
    { loc: 'lo', msgs: loMessages as Record<string, unknown> },
    { loc: 'zh-CN', msgs: zhMessages as Record<string, unknown> },
    { loc: 'km', msgs: kmMessages as Record<string, unknown> },
  ];

  it('the four stub locales cover exactly the same keys', () => {
    const byLocale = STUBS.map(({ loc, msgs }) => ({ loc, keys: keyPaths(msgs).sort() }));
    const reference = byLocale[0]!;
    for (const other of byLocale.slice(1)) {
      // Compared against one reference rather than pairwise: a mismatch names
      // the offending locale directly instead of a set difference.
      expect({ loc: other.loc, keys: other.keys }).toEqual({
        loc: other.loc,
        keys: reference.keys,
      });
    }
  });

  it('every stub key exists in the Thai source (no orphaned translations)', () => {
    const th = new Set(keyPaths(thMessages as Record<string, unknown>));
    for (const { loc, msgs } of STUBS) {
      const orphans = keyPaths(msgs).filter((k) => !th.has(k));
      expect({ loc, orphans }).toEqual({ loc, orphans: [] });
    }
  });
});
