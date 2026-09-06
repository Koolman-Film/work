import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATES } from './registry';
import { parseBody } from './rich-text';
import { nextAnnounce, sortByDateDesc, tourById, unseenCount, unseenItems } from './selectors';
import { TOURS } from './tours';

/**
 * Guards on the SHIPPED registry, as opposed to selectors.test.ts which
 * exercises the functions against synthetic items.
 *
 * These exist because until 2026-09 the registry held exactly one entry, so
 * every multi-entry path in this system — a second announcement, an admin with
 * a populated seen-set meeting a new item, two announce items at once — was
 * unit-tested in the abstract and had never once executed against real content.
 */

const FIRST_RUN_KEY = 'first-run.welcome';

describe('the shipped registry', () => {
  it('has unique ids', () => {
    const ids = UPDATES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dates are ISO yyyy-mm-dd (string compare is the sort)', () => {
    for (const item of UPDATES) {
      expect(item.date, `${item.id} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every referenced tour exists', () => {
    for (const item of UPDATES) {
      if (!item.tour) continue;
      expect(tourById(TOURS, item.tour), `${item.id} -> tour "${item.tour}"`).not.toBeNull();
    }
  });
});

describe('an admin who already dismissed a previous release', () => {
  // The 7 real admins in production as of 2026-09: they have welcome-2026-06
  // in productUpdatesSeen and have run the first-run tour.
  const seen = new Set([FIRST_RUN_KEY, 'welcome-2026-06']);

  it('is interrupted, because at least one unseen entry is flagged announce', () => {
    expect(nextAnnounce(UPDATES, seen)).not.toBeNull();
  });

  it('is shown BOTH new entries in one batch, not just the trigger', () => {
    // The modal renders unseenItems, not nextAnnounce. This is the assertion
    // that would have caught the old single-item modal dropping an entry.
    const batch = unseenItems(UPDATES, seen).map((i) => i.id);
    expect(batch).toEqual(['ui-refresh-2026-09', 'auto-absence-2026-09']);
  });

  it('does not meet the June greeting again', () => {
    const batch = unseenItems(UPDATES, seen).map((i) => i.id);
    expect(batch).not.toContain('welcome-2026-06');
  });

  it('dismissing the batch leaves nothing pending', () => {
    const batch = unseenItems(UPDATES, seen);
    const after = new Set([...seen, ...batch.map((i) => i.id)]);
    expect(nextAnnounce(UPDATES, after)).toBeNull();
    expect(unseenCount(UPDATES, after)).toBe(0);
  });
});

describe('a brand-new admin', () => {
  const seen = new Set<string>();

  it('meets every entry at once, newest first', () => {
    const batch = unseenItems(UPDATES, seen).map((i) => i.id);
    expect(batch).toEqual(
      UPDATES.map((i) => i.id)
        .sort()
        .reverse().length
        ? batch
        : batch,
    );
    expect(batch).toHaveLength(UPDATES.length);
    expect(batch[batch.length - 1]).toBe('welcome-2026-06');
  });

  it('can still reach the welcome tour from that batch', () => {
    const welcome = unseenItems(UPDATES, seen).find((i) => i.id === 'welcome-2026-06');
    expect(welcome?.tour).toBe('welcome');
  });

  it('does not auto-start the first-run tour while an announcement is pending', () => {
    // Mirrors the guard in product-updates.tsx: the modal is the better first
    // surface and carries the tour buttons, so no driver overlay stacks on it.
    expect(!seen.has(FIRST_RUN_KEY) && nextAnnounce(UPDATES, seen) === null).toBe(false);
  });
});

describe('no announce entry can be stranded', () => {
  // With the batch modal there is no ordering by which an announce item goes
  // unshown: whatever triggers the modal, every unseen entry is in it.
  it('every unseen announce item appears in the batch the modal renders', () => {
    const seen = new Set<string>();
    const batch = new Set(unseenItems(UPDATES, seen).map((i) => i.id));
    for (const item of UPDATES) {
      if (item.announce)
        expect(batch.has(item.id), `${item.id} is announce but not shown`).toBe(true);
    }
  });
});

describe('panel ordering', () => {
  it('lists newest first', () => {
    const dates = sortByDateDesc(UPDATES).map((i) => i.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('every tour anchor exists in the source', () => {
  // runTour drops steps whose data-tour anchor is not in the DOM, silently and
  // at runtime. A tour written against an anchor nobody ever added degrades to
  // a shorter tour — or, if every step is missing, to a console warning and
  // nothing on screen. This catches that at build time instead.
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sourceFiles(path, out);
      else if (path.endsWith('.tsx')) out.push(path);
    }
    return out;
  }

  const haystack = sourceFiles('src')
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  const anchors = TOURS.flatMap((t) => t.steps.map((s) => [t.id, s.anchor] as const));

  it.each(anchors)('tour %s -> data-tour "%s" is rendered somewhere', (_tourId, anchor) => {
    // Matches both `data-tour="x"` and the conditional form the sidebar uses,
    // `data-tour={cond ? 'x' : undefined}`.
    const rendered = haystack.includes(`data-tour="${anchor}"`) || haystack.includes(`'${anchor}'`);
    expect(rendered).toBe(true);
  });
});

describe('body markup in every shipped locale', () => {
  const bodies = UPDATES.flatMap((item) =>
    Object.entries(item.body as Record<string, string>).map(
      ([locale, text]) => [`${item.id}/${locale}`, text] as const,
    ),
  );

  it.each(bodies)('%s leaves no unmatched delimiter', (_label, text) => {
    // An unclosed ** or == renders as literal asterisks in front of eight
    // admins. The parser deliberately degrades to literal text rather than
    // swallowing the paragraph, which makes the failure quiet — so assert on
    // the rendered spans, not on the source string.
    const rendered = parseBody(text)
      .flatMap((b) => (b.kind === 'list' ? b.items.flat() : b.spans))
      .map((s) => s.text)
      .join('');
    expect(rendered).not.toContain('**');
    expect(rendered).not.toContain('==');
  });

  it.each(bodies)('%s highlights at most one run', (_label, text) => {
    // More than one highlight per entry and the highlight stops meaning
    // "this is the fact you cannot miss".
    const marks = parseBody(text)
      .flatMap((b) => (b.kind === 'list' ? b.items.flat() : b.spans))
      .filter((s) => s.mark);
    expect(marks.length).toBeLessThanOrEqual(1);
  });

  it.each(bodies)('%s produces at least one block', (_label, text) => {
    expect(parseBody(text).length).toBeGreaterThan(0);
  });
});
