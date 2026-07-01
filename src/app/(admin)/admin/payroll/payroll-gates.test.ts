/**
 * Guardrail: payroll surfaces must gate with requireGlobalPermission, never
 * a bare requirePermission (which would admit a branch-scoped payroll grant
 * and leak all-branch salary). Locks B-payroll-guard Layer 1.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN = path.resolve(__dirname, '..'); // src/app/(admin)/admin
const DIRS = ['payroll', 'settings/payroll', 'tools/recompute-leave'].map((d) =>
  path.join(ADMIN, d),
);
const PAYROLL_PERM_RE =
  /requirePermission\(\s*['"](payroll\.[a-z-]+|settings\.payroll\.manage)['"]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('payroll global-only gate guardrail', () => {
  it('no payroll surface uses a bare requirePermission for a payroll permission', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const f of walk(dir)) {
        if (PAYROLL_PERM_RE.test(fs.readFileSync(f, 'utf8')))
          offenders.push(path.relative(ADMIN, f));
      }
    }
    expect(
      offenders,
      `These payroll files still use requirePermission for a payroll permission — use requireGlobalPermission:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });
});
