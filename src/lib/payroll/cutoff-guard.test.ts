import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every payroll window must come from cutoff-load.ts, which applies the
 * employee's branch override. A stray `select: { cutoffDay: true }` or
 * `cfg.cutoffDay` silently uses the company day for Central Audio, putting its
 * 27–31 days in the wrong month with no error anywhere. This scan makes that
 * mistake fail CI instead.
 */

const SRC = join(__dirname, '..', '..');

// Files allowed to touch the column: the loader itself, the pure rule (branch
// rows also have a `cutoffDay`), the override admin, and the settings screen
// that EDITS the company day.
const ALLOWED = new Set([
  'lib/payroll/cutoff-load.ts',
  'lib/payroll/cutoff-rule.ts',
  'lib/payroll/branch-cutoff-admin.ts',
  'app/(admin)/admin/settings/attendance/actions.ts',
  'app/(admin)/admin/settings/attendance/page.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('cut-off reads go through cutoff-load.ts', () => {
  it('no other source file reads PayrollConfig.cutoffDay', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (/cutoffDay\s*:\s*true|\w\??\.cutoffDay\b/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
