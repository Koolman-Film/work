/**
 * Guardrail: payroll surfaces must gate with requireGlobalPermission, never
 * a bare requirePermission (which would admit a branch-scoped payroll grant
 * and leak all-branch salary, or — for penalty settlement — let a
 * branch-scoped actor spend another branch's leave entitlement). Locks
 * B-payroll-guard Layer 1.
 *
 * Walks both the admin route surfaces AND src/lib/payroll: the bug this
 * guardrail was written for (penalty-settlement-admin.ts using a bare
 * requirePermission) lived in the lib module, not under
 * src/app/(admin)/admin/payroll — a route-only walk has a blind spot for
 * any server action defined outside the admin tree. Each entry is an
 * absolute dir; `label` is only used to make failure output readable.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN = path.resolve(__dirname, '..'); // src/app/(admin)/admin
const SRC = path.resolve(__dirname, '../../../..'); // src

const ROOTS: { dir: string; label: string }[] = [
  ...['payroll', 'settings/payroll', 'tools/recompute-leave'].map((d) => ({
    dir: path.join(ADMIN, d),
    label: path.posix.join('admin', d),
  })),
  { dir: path.join(SRC, 'lib/payroll'), label: 'lib/payroll' },
];
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
    for (const { dir, label } of ROOTS) {
      for (const f of walk(dir)) {
        if (PAYROLL_PERM_RE.test(fs.readFileSync(f, 'utf8')))
          offenders.push(path.posix.join(label, path.relative(dir, f).split(path.sep).join('/')));
      }
    }
    expect(
      offenders,
      `These payroll files still use requirePermission for a payroll permission — use requireGlobalPermission:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });
});
