import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A holiday read that ignores `branchIds` treats one branch's closure as a day
 * off for everybody: lateness and absences go uncharged at the branches that
 * were open. Every `holiday.findMany/findFirst` must therefore either select
 * `branchIds` (directly or via HOLIDAY_SCOPE_SELECT) or restrict itself to
 * company holidays (`branchIds: { isEmpty: true }`). This scan fails CI on one
 * that does neither.
 */

const SRC = join(__dirname, '..', '..');
// One-off ops scripts (backfills, recomputes, seeds) read holidays too and can
// write the same money columns, so they are held to the same rule.
const PRISMA = join(SRC, '..', 'prisma');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'migrations') walk(p, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The argument text of the call starting at `open` (the `(`), brace-matched. */
function callArgs(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

describe('holiday reads are branch-aware', () => {
  it('every holiday.findMany/findFirst selects branchIds or filters to company holidays', () => {
    const offenders: string[] = [];
    for (const file of [...walk(SRC), ...walk(PRISMA)]) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/\.holiday\.(findMany|findFirst)\s*\(/g)) {
        const args = callArgs(code, (m.index ?? 0) + m[0].length - 1);
        if (!/branchIds|HOLIDAY_SCOPE_SELECT/.test(args)) {
          const line = code.slice(0, m.index).split('\n').length;
          offenders.push(`${relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
