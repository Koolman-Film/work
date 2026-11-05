import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ICU 79 (Node 26) appends " น." to Thai times. Vercel picked Node 26 up on
 * its own on 2026-11-05 and every Thai time in the app changed overnight —
 * some to "14:30 น. น.", where the screen already wrote its own suffix.
 * `formatClock` (./format.ts) strips it; this scan fails CI on a time
 * formatted any other way in a locale that may be Thai.
 *
 * Flagged: `toLocaleTimeString(` / `toLocaleString(` / `new
 * Intl.DateTimeFormat(` whose locale is 'th', 'th-TH' or a variable, and whose
 * options include `hour` or `timeStyle`. A fixed non-Thai locale ('en-GB',
 * used for machine-readable HH:mm) is fine.
 */

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function callArgs(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

const CALL = /(?:\.toLocaleTimeString|\.toLocaleString|new Intl\.DateTimeFormat)\(/g;

describe('Thai times go through formatClock', () => {
  it('no direct Intl time formatting in a possibly-Thai locale', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(join('i18n', 'format.ts'))) continue; // formatClock itself
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(CALL)) {
        const args = callArgs(code, (m.index ?? 0) + m[0].length - 1);
        const locale = /^\(\s*([^,)]+)/.exec(args)?.[1]?.trim() ?? '';
        const fixedNonThai = /^'(?!th)[^']*'$/.test(locale);
        if (fixedNonThai) continue;
        const hasTime = /\b(hour|timeStyle)\s*:/.test(args);
        const timeOnly = m[0] === '.toLocaleTimeString(';
        if (hasTime || timeOnly) {
          const line = code.slice(0, m.index).split('\n').length;
          offenders.push(`${relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(offenders, 'use formatClock from @/lib/i18n/format').toEqual([]);
  });
});
