/**
 * Guardrail: every admin entry point that reads an employee-linked model must
 * reference a branch-scope primitive (or global-only gate), or be explicitly
 * EXEMPTed with a reason. Catches "gated but unscoped" surfaces (the class that
 * let the Overtime module ship all-branch reads). Coarse (file-level): proves a
 * file scopes SOMETHING, not that every read is scoped — but a totally-unscoped
 * surface (the real failure mode) is caught.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN = __dirname; // src/app/(admin)/admin
const READ_RE =
  /prisma(?:Raw)?\.(?:attendance|leaveRequest|cashAdvance|employee|overtimeEntry)\.(?:findMany|findFirst|findUnique|count|groupBy|aggregate)/;
const SCOPE_RE =
  /getPermittedBranches|employeeBranchScope|viaEmployeeBranchScope|canActOnEmployeeBranches|requireGlobalPermission/;

/** Files that read an employee-linked model but are legitimately unscoped.
 *  Each MUST carry a reason. Add here only after confirming it's genuinely exempt. */
const EXEMPT: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'settings/accounting-groups/actions.ts',
    reason:
      "prisma.employee.count referential-integrity (dependents) check before mutate; behind settings.accounting-group.manage; org-config, count-only.",
  },
  {
    file: 'settings/departments/actions.ts',
    reason:
      "prisma.employee.count dependents before delete; behind settings.department.manage; org-config, count-only.",
  },
  {
    file: 'settings/work-schedules/actions.ts',
    reason:
      "prisma.employee.count usage before delete; behind settings.work-schedule.manage; org-config, count-only.",
  },
  {
    file: 'settings/leave-types/actions.ts',
    reason:
      "prisma.leaveRequest.count active references before delete; behind settings.leave-type.manage; org-config referential-integrity, count-only.",
  },
  {
    file: 'settings/branches/actions.ts',
    reason:
      "prisma.employee.count dependents before delete; behind settings.branch.manage; org-config, count-only.",
  },
  {
    file: 'payroll/adjustments/_employee-options.ts',
    reason:
      "prisma.employee.findMany for the adjustment picker; payroll layout.tsx gates every payroll page with requireGlobalPermission('payroll.read'), so it is reached only by a global actor — all-branch list is correct for global-only payroll.",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.test.tsx'))
      out.push(full);
  }
  return out;
}

describe('scope-presence guardrail (admin entry points)', () => {
  const exemptSet = new Set(EXEMPT.map((e) => e.file));

  it('every admin file reading an employee-linked model references a scope primitive (or is EXEMPT)', () => {
    const offenders: string[] = [];
    for (const f of walk(ADMIN)) {
      const rel = path.relative(ADMIN, f);
      if (exemptSet.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (READ_RE.test(text) && !SCOPE_RE.test(text)) offenders.push(rel);
    }
    expect(
      offenders,
      `Admin files read an employee-linked model without a branch-scope primitive.\nScope them, or add to EXEMPT with a reason:\n${offenders.map((r) => `  • ${r}`).join('\n')}`,
    ).toHaveLength(0);
  });
});
