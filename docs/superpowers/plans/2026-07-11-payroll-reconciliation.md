# Payroll Run Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only pre-publish reconciliation page (`/admin/payroll/reconcile?m=`) that flags payroll anomalies before an admin publishes a run.

**Architecture:** Pure anomaly engine (`reconcile.ts`) + server-only data loader (`reconcile-data.ts`) + a server-component page + a link from the payroll page. No schema changes, no writes — everything is derived live from `Payroll` / `PayrollAdjustment`.

**Tech Stack:** Next.js 16 App Router (server components), Prisma/Postgres, Vitest (unit + integration), Tailwind, Biome.

## Global Constraints

- **Read-only / additive only:** no `prisma.*.create/update/delete/upsert`, no schema/migration, no audit writes. The feature only reads.
- **Global-only gate:** every payroll surface uses `requireGlobalPermission('payroll.read')` from `@/lib/auth/require-global-permission` — never a bare `requirePermission` for a payroll permission (locked by `payroll-gates.test.ts`).
- **Month format:** `const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;` (copy verbatim; used app-wide).
- **Money/label formatting:** `formatTHB2(amount: number): string` and `monthLabelTh(month: string): string` from `@/lib/format`. Do not hand-roll.
- **Active employee roster:** `archivedAt: null` (the filter `src/lib/reports/queries.ts` uses).
- **Thresholds:** `swingPct = 0.20`, `swingMin = 1000`, `lowNetPct = 0.50`, `deductionJump = 2000`.
- **Decimal → number** conversion happens in the loader (`.toNumber()`); the pure engine and the page work in plain `number`.

---

### Task 1: Pure anomaly engine — `reconcile.ts`

**Files:**
- Create: `src/lib/payroll/reconcile.ts`
- Test: `src/lib/payroll/reconcile.test.ts`

**Interfaces:**
- Produces: `RECONCILE_THRESHOLDS`, `DEDUCTION_COMPONENTS`, types `DeductionComponent`, `PayrollBreakdown`, `ReconcileFlag`, `flagRow(current, baseline, t?)`, `severityRank(flag)`, `topSeverity(flags)`, `sortFlaggedRows(rows)`. Consumed by Task 2 (loader) and Task 3 (page).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/payroll/reconcile.test.ts
import { describe, expect, it } from 'vitest';
import {
  flagRow,
  type PayrollBreakdown,
  RECONCILE_THRESHOLDS as T,
  severityRank,
  sortFlaggedRows,
  topSeverity,
} from './reconcile';

const zero: PayrollBreakdown = {
  incomeBase: 0, incomeOther: 0, deductSso: 0, deductAdvance: 0,
  deductAttendance: 0, deductLeave: 0, deductDebt: 0, deductOther: 0, netPay: 0,
};
const row = (o: Partial<PayrollBreakdown>): PayrollBreakdown => ({ ...zero, ...o });
const base = (o: Partial<PayrollBreakdown> & { month?: string }) => ({
  ...zero, ...o, month: o.month ?? '2026-05',
});

describe('flagRow', () => {
  it('missing-from-run when current is null but a baseline exists', () => {
    expect(flagRow(null, base({ netPay: 19000 }))).toEqual([{ kind: 'missing-from-run' }]);
  });

  it('no flags when both current and baseline are null', () => {
    expect(flagRow(null, null)).toEqual([]);
  });

  it('net-nonpositive when netPay <= 0', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 0 }), base({ netPay: 19000 }));
    expect(flags).toContainEqual({ kind: 'net-nonpositive' });
  });

  it('low-net when positive net is under 50% of gross', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 9000 }), base({ netPay: 9500 }));
    expect(flags).toContainEqual({ kind: 'low-net' });
  });

  it('does NOT flag low-net at exactly 50% of gross', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 10000 }), base({ netPay: 10000 }));
    expect(flags.some((f) => f.kind === 'low-net')).toBe(false);
  });

  it('new-this-month when there is no baseline', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 19000 }), null);
    expect(flags).toContainEqual({ kind: 'new-this-month' });
    // no swing/deduction flags without a baseline
    expect(flags.some((f) => f.kind === 'net-swing' || f.kind === 'deduction-jump')).toBe(false);
  });

  it('net-swing when |delta| >= 1000 AND >= 20% of baseline', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 12400 }), base({ netPay: 19000 }));
    const swing = flags.find((f) => f.kind === 'net-swing');
    expect(swing).toBeTruthy();
    if (swing?.kind === 'net-swing') {
      expect(swing.deltaAbs).toBe(-6600);
      expect(swing.baselineMonth).toBe('2026-05');
    }
  });

  it('no net-swing when the % is large but absolute < 1000', () => {
    // baseline 800 → current 1500: +700 abs (<1000) even though +87%
    const flags = flagRow(row({ incomeBase: 1500, netPay: 1500 }), base({ netPay: 800 }));
    expect(flags.some((f) => f.kind === 'net-swing')).toBe(false);
  });

  it('no net-swing when absolute is large but < 20% of baseline', () => {
    // baseline 100000 → 98500: -1500 abs (>=1000) but -1.5% (<20%)
    const flags = flagRow(row({ incomeBase: 100000, netPay: 98500 }), base({ netPay: 100000 }));
    expect(flags.some((f) => f.kind === 'net-swing')).toBe(false);
  });

  it('deduction-jump when a component goes 0 -> >0', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductAttendance: 500, netPay: 19500 }),
      base({ netPay: 20000 }),
    );
    expect(flags).toContainEqual({ kind: 'deduction-jump', component: 'deductAttendance', from: 0, to: 500 });
  });

  it('deduction-jump when a component rises by >= 2000', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductDebt: 3000, netPay: 17000 }),
      base({ deductDebt: 500, netPay: 19500 }),
    );
    expect(flags).toContainEqual({ kind: 'deduction-jump', component: 'deductDebt', from: 500, to: 3000 });
  });

  it('no deduction-jump for a sub-2000 rise on an already-nonzero component', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductSso: 750, netPay: 19250 }),
      base({ deductSso: 250, netPay: 19750 }),
    );
    expect(flags.some((f) => f.kind === 'deduction-jump')).toBe(false);
  });
});

describe('severity + sort', () => {
  it('ranks net-nonpositive above deduction-jump', () => {
    expect(severityRank({ kind: 'net-nonpositive' })).toBeLessThan(
      severityRank({ kind: 'deduction-jump', component: 'deductSso', from: 0, to: 5000 }),
    );
  });

  it('topSeverity picks the lowest (most severe) rank across a row', () => {
    expect(
      topSeverity([
        { kind: 'deduction-jump', component: 'deductSso', from: 0, to: 5000 },
        { kind: 'net-nonpositive' },
      ]),
    ).toBe(1);
  });

  it('sorts by top severity, then by descending |netDeltaAbs|', () => {
    const rows = [
      { id: 'a', flags: [{ kind: 'new-this-month' } as const], netDeltaAbs: 0 },
      { id: 'b', flags: [{ kind: 'net-nonpositive' } as const], netDeltaAbs: 100 },
      { id: 'c', flags: [{ kind: 'net-swing', deltaAbs: -9000, deltaPct: -0.4, baselineMonth: '2026-05' } as const], netDeltaAbs: 9000 },
      { id: 'd', flags: [{ kind: 'net-swing', deltaAbs: -3000, deltaPct: -0.2, baselineMonth: '2026-05' } as const], netDeltaAbs: 3000 },
    ];
    expect(sortFlaggedRows(rows).map((r) => r.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/payroll/reconcile.test.ts`
Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/payroll/reconcile.ts
//
// Pure anomaly engine for pre-publish payroll reconciliation. No DB, no I/O —
// the loader (reconcile-data.ts) converts Prisma Decimals to numbers and calls
// flagRow per employee. See docs/superpowers/specs/2026-07-11-payroll-reconciliation-design.md.

export const RECONCILE_THRESHOLDS = {
  swingPct: 0.2,
  swingMin: 1000,
  lowNetPct: 0.5,
  deductionJump: 2000,
} as const;

export type DeductionComponent =
  | 'deductSso'
  | 'deductAdvance'
  | 'deductAttendance'
  | 'deductLeave'
  | 'deductDebt'
  | 'deductOther';

export const DEDUCTION_COMPONENTS: readonly DeductionComponent[] = [
  'deductSso',
  'deductAdvance',
  'deductAttendance',
  'deductLeave',
  'deductDebt',
  'deductOther',
];

export type PayrollBreakdown = {
  incomeBase: number;
  incomeOther: number;
  deductSso: number;
  deductAdvance: number;
  deductAttendance: number;
  deductLeave: number;
  deductDebt: number;
  deductOther: number;
  netPay: number;
};

export type ReconcileFlag =
  | { kind: 'net-nonpositive' }
  | { kind: 'missing-from-run' }
  | { kind: 'low-net' }
  | { kind: 'net-swing'; deltaAbs: number; deltaPct: number; baselineMonth: string }
  | { kind: 'new-this-month' }
  | { kind: 'deduction-jump'; component: DeductionComponent; from: number; to: number };

const SEVERITY: Record<ReconcileFlag['kind'], number> = {
  'net-nonpositive': 1,
  'missing-from-run': 2,
  'low-net': 3,
  'net-swing': 4,
  'new-this-month': 5,
  'deduction-jump': 6,
};

export function severityRank(flag: ReconcileFlag): number {
  return SEVERITY[flag.kind];
}

export function topSeverity(flags: readonly ReconcileFlag[]): number {
  return flags.reduce((min, f) => Math.min(min, severityRank(f)), Number.POSITIVE_INFINITY);
}

/**
 * Flags for one employee. `current` is null when an active employee has no
 * Payroll row this month; `baseline` is null when they have never been paid.
 */
export function flagRow(
  current: PayrollBreakdown | null,
  baseline: (PayrollBreakdown & { month: string }) | null,
  t: typeof RECONCILE_THRESHOLDS = RECONCILE_THRESHOLDS,
): ReconcileFlag[] {
  if (current === null) {
    // Caller only passes active employees; a baseline means they were paid
    // before and have now dropped out of the run.
    return baseline ? [{ kind: 'missing-from-run' }] : [];
  }

  const flags: ReconcileFlag[] = [];
  const gross = current.incomeBase + current.incomeOther;

  if (current.netPay <= 0) flags.push({ kind: 'net-nonpositive' });
  if (gross > 0 && current.netPay > 0 && current.netPay < t.lowNetPct * gross) {
    flags.push({ kind: 'low-net' });
  }

  if (!baseline) {
    flags.push({ kind: 'new-this-month' });
    return flags;
  }

  const deltaAbs = current.netPay - baseline.netPay;
  if (
    Math.abs(deltaAbs) >= t.swingMin &&
    baseline.netPay > 0 &&
    Math.abs(deltaAbs) >= t.swingPct * baseline.netPay
  ) {
    flags.push({
      kind: 'net-swing',
      deltaAbs,
      deltaPct: deltaAbs / baseline.netPay,
      baselineMonth: baseline.month,
    });
  }

  for (const comp of DEDUCTION_COMPONENTS) {
    const from = baseline[comp];
    const to = current[comp];
    if ((from === 0 && to > 0) || to - from >= t.deductionJump) {
      flags.push({ kind: 'deduction-jump', component: comp, from, to });
    }
  }

  return flags;
}

export function sortFlaggedRows<T extends { flags: readonly ReconcileFlag[]; netDeltaAbs: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sa = topSeverity(a.flags);
    const sb = topSeverity(b.flags);
    if (sa !== sb) return sa - sb;
    return b.netDeltaAbs - a.netDeltaAbs;
  });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/payroll/reconcile.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npx biome check src/lib/payroll/reconcile.ts src/lib/payroll/reconcile.test.ts`
```bash
git add src/lib/payroll/reconcile.ts src/lib/payroll/reconcile.test.ts
git commit -m "feat(payroll): pure reconciliation anomaly engine (flagRow + sort)"
```

---

### Task 2: Data loader — `reconcile-data.ts`

**Files:**
- Create: `src/lib/payroll/reconcile-data.ts`
- Test: `tests/integration/reconcile-data.integration.test.ts`

**Interfaces:**
- Consumes: `flagRow`, `PayrollBreakdown`, `ReconcileFlag`, `DeductionComponent` from `./reconcile` (Task 1); `prisma` from `@/lib/db/prisma`.
- Produces: types `ReconRow`, `ReconciliationView`; `loadReconciliation(month: string): Promise<ReconciliationView>`. Consumed by Task 3 (page).

**Behavior spec:**
- Load, in parallel:
  - **Current rows:** `prisma.payroll.findMany({ where: { month }, include: { employee: { select: { id, firstName, lastName, branchId, archivedAt, branch: { select: { name } } } } } })`.
  - **Active roster:** `prisma.employee.findMany({ where: { archivedAt: null }, select: { id, firstName, lastName, branchId, branch: { select: { name } } } })` — needed for "missing from run".
  - **Baselines:** the most recent Published/Locked `Payroll` per employee with `month < :month`. Query `prisma.payroll.findMany({ where: { month: { lt: month }, status: { in: ['Published','Locked'] } }, orderBy: { month: 'desc' } })` and reduce to the first (newest) row seen per `employeeId` (Map keyed by employeeId; because ordered desc, the first occurrence wins).
  - **Adjustments:** `prisma.payrollAdjustment.findMany({ where: { deletedAt: null, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] }, select: { employeeId, kind, reason, amount } })` — the adjustments that apply to `month`, grouped by `employeeId`.
- **Row universe** = union of (active employees) ∪ (employees who have a current row). Iterate that union; for each:
  - `current` = the `Payroll` breakdown for this month as numbers (via `.toNumber()`), or `null` if none.
  - `baseline` = the reduced baseline (numbers + its `month`), or `null`.
  - `flags = flagRow(current, baseline)`.
  - `name = `${firstName} ${lastName}``, `branchName = branch?.name ?? '—'`, `netDeltaAbs = current && baseline ? Math.abs(current.netPay - baseline.netPay) : 0`.
  - `adjustments` = the employee's applicable adjustments (`amount.toNumber()`).
- **Totals:** `gross = Σ(incomeBase + incomeOther)`, `deductions = Σ(all six deduction columns)`, `net = Σ netPay`, `headcount = count of rows with a current`. Over current rows only.
- **byBranch:** group current rows by `branchName`; `{ branchId, branchName, net, headcount }`, sorted by branchName.
- **status:** `'None'` if no current rows; else `'Draft'` if any current row is Draft, else `'Published'` if any Published, else `'Locked'`.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/reconcile-data.integration.test.ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadReconciliation } from '@/lib/payroll/reconcile-data';

async function reset() {
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}
beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

async function emp(branchId: string, firstName: string, salary = 20000) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id, firstName, lastName: 'ทดสอบ', branchId,
      salaryType: 'Monthly', baseSalary: new Prisma.Decimal(salary),
      status: 'Active', hiredAt: new Date('2026-01-01'),
    },
  });
}
async function pay(
  employeeId: string, month: string, status: 'Draft' | 'Published' | 'Locked',
  o: { incomeBase?: number; netPay?: number; deductAttendance?: number } = {},
) {
  return prisma.payroll.create({
    data: {
      employeeId, month, status,
      incomeBase: new Prisma.Decimal(o.incomeBase ?? 20000),
      netPay: new Prisma.Decimal(o.netPay ?? 19000),
      deductAttendance: new Prisma.Decimal(o.deductAttendance ?? 0),
    },
  });
}

describe('loadReconciliation', () => {
  it('uses the latest FROZEN prior month as baseline (ignores a newer Draft, skips gaps)', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await emp(b.id, 'ก');
    await pay(e.id, '2026-04', 'Locked', { netPay: 19000 });
    // no May row at all (gap) — April is the baseline for June
    await pay(e.id, '2026-06', 'Draft', { netPay: 12000 }); // -37% vs April
    const view = await loadReconciliation('2026-06');
    const rowE = view.rows.find((r) => r.employeeId === e.id);
    expect(rowE?.baseline?.month).toBe('2026-04');
    expect(rowE?.flags.some((f) => f.kind === 'net-swing')).toBe(true);
  });

  it('flags missing-from-run for an active employee with a baseline but no current row', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await emp(b.id, 'ข');
    await pay(e.id, '2026-05', 'Published', { netPay: 19000 });
    // no 2026-06 row
    const view = await loadReconciliation('2026-06');
    const rowE = view.rows.find((r) => r.employeeId === e.id);
    expect(rowE?.current).toBeNull();
    expect(rowE?.flags).toContainEqual({ kind: 'missing-from-run' });
  });

  it('excludes archived employees from the roster and computes branch subtotals + totals', async () => {
    const hq = await prisma.branch.create({ data: { name: 'HQ' } });
    const cnx = await prisma.branch.create({ data: { name: 'CNX' } });
    const a = await emp(hq.id, 'ค');
    const c = await emp(cnx.id, 'ง');
    const archived = await emp(hq.id, 'จ');
    await prisma.employee.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await pay(a.id, '2026-06', 'Draft', { incomeBase: 20000, netPay: 19000 });
    await pay(c.id, '2026-06', 'Draft', { incomeBase: 30000, netPay: 28000 });
    const view = await loadReconciliation('2026-06');
    expect(view.rows.some((r) => r.employeeId === archived.id)).toBe(false);
    expect(view.totals.headcount).toBe(2);
    expect(view.totals.net).toBe(47000);
    expect(view.byBranch.find((x) => x.branchName === 'CNX')?.net).toBe(28000);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:integration -- reconcile-data`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `loadReconciliation`**

Implement per the Behavior spec above. Key points:
- Convert every `Decimal` with `.toNumber()` when building `PayrollBreakdown`.
- Baseline reduction: iterate the desc-ordered prior-frozen rows; `if (!map.has(employeeId)) map.set(employeeId, breakdown)`.
- Row universe: build a `Map<employeeId, {employee fields}>` from the active roster, then merge in any current-row employees not already present (e.g. an employee archived *after* being added to the run still has a current row and should show — include them).
- Types to export:

```ts
export type ReconRow = {
  employeeId: string;
  name: string;
  branchName: string;
  current: PayrollBreakdown | null;
  baseline: (PayrollBreakdown & { month: string }) | null;
  netDeltaAbs: number;
  adjustments: { kind: 'Income' | 'Deduction'; reason: string; amount: number }[];
  flags: ReconcileFlag[];
};
export type ReconciliationView = {
  month: string;
  status: 'Draft' | 'Published' | 'Locked' | 'None';
  totals: { gross: number; deductions: number; net: number; headcount: number };
  byBranch: { branchId: string; branchName: string; net: number; headcount: number }[];
  rows: ReconRow[];
};
export async function loadReconciliation(month: string): Promise<ReconciliationView> { /* ... */ }
```

Add `import 'server-only';` at the top (matches `history.ts`).

Reference implementation:

```ts
// src/lib/payroll/reconcile-data.ts
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { flagRow, type PayrollBreakdown, type ReconcileFlag } from './reconcile';

export type ReconRow = {
  employeeId: string;
  name: string;
  branchName: string;
  current: PayrollBreakdown | null;
  baseline: (PayrollBreakdown & { month: string }) | null;
  netDeltaAbs: number;
  adjustments: { kind: 'Income' | 'Deduction'; reason: string; amount: number }[];
  flags: ReconcileFlag[];
};
export type ReconciliationView = {
  month: string;
  status: 'Draft' | 'Published' | 'Locked' | 'None';
  totals: { gross: number; deductions: number; net: number; headcount: number };
  byBranch: { branchId: string; branchName: string; net: number; headcount: number }[];
  rows: ReconRow[];
};

const PAY_SELECT = {
  incomeBase: true, incomeOther: true, deductSso: true, deductAdvance: true,
  deductAttendance: true, deductLeave: true, deductDebt: true, deductOther: true, netPay: true,
} as const;

// Prisma Decimal fields → plain numbers.
function toBreakdown(p: Record<keyof typeof PAY_SELECT, { toNumber(): number }>): PayrollBreakdown {
  return {
    incomeBase: p.incomeBase.toNumber(),
    incomeOther: p.incomeOther.toNumber(),
    deductSso: p.deductSso.toNumber(),
    deductAdvance: p.deductAdvance.toNumber(),
    deductAttendance: p.deductAttendance.toNumber(),
    deductLeave: p.deductLeave.toNumber(),
    deductDebt: p.deductDebt.toNumber(),
    deductOther: p.deductOther.toNumber(),
    netPay: p.netPay.toNumber(),
  };
}

export async function loadReconciliation(month: string): Promise<ReconciliationView> {
  const [current, roster, priorFrozen, adjustments] = await Promise.all([
    prisma.payroll.findMany({
      where: { month },
      select: {
        employeeId: true, status: true, ...PAY_SELECT,
        employee: {
          select: {
            firstName: true, lastName: true, branchId: true,
            branch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null },
      select: {
        id: true, firstName: true, lastName: true, branchId: true,
        branch: { select: { name: true } },
      },
    }),
    prisma.payroll.findMany({
      where: { month: { lt: month }, status: { in: ['Published', 'Locked'] } },
      orderBy: { month: 'desc' },
      select: { employeeId: true, month: true, ...PAY_SELECT },
    }),
    prisma.payrollAdjustment.findMany({
      where: {
        deletedAt: null,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
      },
      select: { employeeId: true, kind: true, reason: true, amount: true },
    }),
  ]);

  // Baseline = newest frozen prior row per employee (priorFrozen is month-desc).
  const baselineByEmp = new Map<string, PayrollBreakdown & { month: string }>();
  for (const p of priorFrozen) {
    if (!baselineByEmp.has(p.employeeId)) {
      baselineByEmp.set(p.employeeId, { ...toBreakdown(p), month: p.month });
    }
  }

  const adjByEmp = new Map<string, ReconRow['adjustments']>();
  for (const a of adjustments) {
    const list = adjByEmp.get(a.employeeId) ?? [];
    list.push({ kind: a.kind as 'Income' | 'Deduction', reason: a.reason, amount: a.amount.toNumber() });
    adjByEmp.set(a.employeeId, list);
  }

  const currentByEmp = new Map(current.map((p) => [p.employeeId, p]));

  // Row universe = active roster ∪ everyone with a current row (an employee
  // archived AFTER being added to the run still has a current row to show).
  const meta = new Map<string, { name: string; branchId: string | null; branchName: string }>();
  for (const e of roster) {
    meta.set(e.id, {
      name: `${e.firstName} ${e.lastName}`,
      branchId: e.branchId,
      branchName: e.branch?.name ?? '—',
    });
  }
  for (const p of current) {
    if (!meta.has(p.employeeId)) {
      meta.set(p.employeeId, {
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        branchId: p.employee.branchId,
        branchName: p.employee.branch?.name ?? '—',
      });
    }
  }

  const rows: ReconRow[] = [];
  for (const [employeeId, m] of meta) {
    const cur = currentByEmp.get(employeeId);
    const current2 = cur ? toBreakdown(cur) : null;
    const baseline = baselineByEmp.get(employeeId) ?? null;
    rows.push({
      employeeId,
      name: m.name,
      branchName: m.branchName,
      current: current2,
      baseline,
      netDeltaAbs: current2 && baseline ? Math.abs(current2.netPay - baseline.netPay) : 0,
      adjustments: adjByEmp.get(employeeId) ?? [],
      flags: flagRow(current2, baseline),
    });
  }

  // Totals + byBranch over current rows only.
  let gross = 0;
  let deductions = 0;
  let net = 0;
  const branchAcc = new Map<string, { branchId: string; branchName: string; net: number; headcount: number }>();
  for (const p of current) {
    const b = toBreakdown(p);
    gross += b.incomeBase + b.incomeOther;
    deductions +=
      b.deductSso + b.deductAdvance + b.deductAttendance + b.deductLeave + b.deductDebt + b.deductOther;
    net += b.netPay;
    const branchName = p.employee.branch?.name ?? '—';
    const key = p.employee.branchId ?? '—';
    const acc = branchAcc.get(key) ?? {
      branchId: p.employee.branchId ?? '—',
      branchName,
      net: 0,
      headcount: 0,
    };
    acc.net += b.netPay;
    acc.headcount += 1;
    branchAcc.set(key, acc);
  }

  const anyStatus = (s: 'Draft' | 'Published' | 'Locked') => current.some((p) => p.status === s);
  const status: ReconciliationView['status'] =
    current.length === 0 ? 'None' : anyStatus('Draft') ? 'Draft' : anyStatus('Published') ? 'Published' : 'Locked';

  return {
    month,
    status,
    totals: { gross, deductions, net, headcount: current.length },
    byBranch: [...branchAcc.values()].sort((a, b) => a.branchName.localeCompare(b.branchName)),
    rows,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:integration -- reconcile-data`
Expected: PASS (3 tests).

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npx biome check src/lib/payroll/reconcile-data.ts tests/integration/reconcile-data.integration.test.ts`
```bash
git add src/lib/payroll/reconcile-data.ts tests/integration/reconcile-data.integration.test.ts
git commit -m "feat(payroll): reconciliation data loader (baselines, roster, totals)"
```

---

### Task 3: Reconciliation page — `reconcile/page.tsx`

**Files:**
- Create: `src/app/(admin)/admin/payroll/reconcile/page.tsx`
- Create: `src/app/(admin)/admin/payroll/reconcile/reconcile-rows.tsx` (client child for expand/collapse)

**Interfaces:**
- Consumes: `loadReconciliation`, `ReconciliationView`, `ReconRow` (Task 2); `flagRow`/`sortFlaggedRows`/`ReconcileFlag` (Task 1); `formatTHB2`, `monthLabelTh` (`@/lib/format`); `requireGlobalPermission` (`@/lib/auth/require-global-permission`).

**Spec:**
- Server component. `const { user } = await requireGlobalPermission('payroll.read');`. Read `?m=`; `const month = m && MONTH_RE.test(m) ? m : currentMonth();` (reuse `currentMonth()` from the payroll page's helper — import it or replicate the one-liner; if replicating, use the same Bangkok-day logic already in `admin/payroll/page.tsx`). Malformed handled by falling back to current month (matches the payroll page).
- `const view = await loadReconciliation(month);`
- Render, in order:
  1. **Header** — `monthLabelTh(month)`, status badge, a back-link to `/admin/payroll?m=${month}`.
  2. **Run summary** — headcount, `formatTHB2(view.totals.gross)`, `formatTHB2(view.totals.deductions)`, `formatTHB2(view.totals.net)`; then a **net-by-branch** table (`view.byBranch`: branchName, headcount, `formatTHB2(net)`).
  3. **Needs review** — `sortFlaggedRows(view.rows.filter((r) => r.flags.length > 0))`. For each: name + branchName, `current?.netPay` vs `baseline?.netPay` with Δ (abs via `formatTHB2`, % via the `net-swing` flag if present), a **chip per flag** (see chip copy below), and a **fix link** (`/admin/employees/${employeeId}/edit` — the employee record; the adjustments list lives at `/admin/payroll/adjustments`, link there when a `deduction-jump`/adjustment is involved). If none: a green empty state — `"ไม่พบความผิดปกติ — ${headcount} รายการอยู่ในเกณฑ์ปกติ"`.
  4. **All rows** (collapsed by default) — the full `view.rows` in the same gross→net format.
- The **per-row expandable derivation** and the **all-rows collapse** are the client child `reconcile-rows.tsx` (`'use client'`): given the already-loaded rows (passed as props — plain serializable data), it renders the expand/collapse UI. The eight breakdown lines side-by-side with baseline, changed lines highlighted, plus the row's `adjustments` list.
- **Chip copy** (Thai; add to locale files in Task 4 or inline here as literals — match how the payroll page writes Thai status labels inline):
  - `net-nonpositive` → `"สุทธิ ≤ 0"`
  - `missing-from-run` → `"หายจากรอบนี้"`
  - `low-net` → `"สุทธิต่ำผิดปกติ"`
  - `net-swing` → `` `สุทธิ ${pct}% เทียบ ${monthLabelTh(baselineMonth)}` `` (pct = `Math.round(deltaPct * 100)` with sign)
  - `new-this-month` → `"พนักงานใหม่"`
  - `deduction-jump` → `` `${componentLabel(component)} ${formatTHB2(to)} (เดิม ${formatTHB2(from)})` `` where `componentLabel` maps the six columns to Thai (`deductAttendance` → `"หักขาด/สาย"`, `deductAdvance` → `"หักเบิกล่วงหน้า"`, `deductSso` → `"ประกันสังคม"`, `deductLeave` → `"หักลา"`, `deductDebt` → `"หักหนี้"`, `deductOther` → `"หักอื่นๆ"`).
- Styling: reuse the payroll page's card/table Tailwind conventions (`surface`, `tabular-nums`, `text-ink-*`). Do not invent a new visual language.

- [ ] **Step 1: Build the page + client child** per the spec. No unit test (server-component UI over already-tested logic; the loader + engine carry the coverage — matches the LIFF/list pattern in prior features).

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npx biome check "src/app/(admin)/admin/payroll/reconcile/"`
Expected: clean.

- [ ] **Step 3: Manual smoke** (if a dev server + seeded published+draft month is available): log in as a global-payroll admin, open `/admin/payroll/reconcile?m=<month>`, confirm the summary, a flagged row with chips, an expanded derivation, and the empty state on a clean month. (Same manual posture as recent features; not a blocker if no seeded data.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/payroll/reconcile/"
git commit -m "feat(payroll): pre-publish reconciliation review page"
```

---

### Task 4: Link from the payroll page + i18n labels

**Files:**
- Modify: `src/app/(admin)/admin/payroll/page.tsx`
- Modify: locale files under `src/…/messages` (or wherever the app's i18n JSON lives) — only if the page uses translation keys; if it uses inline Thai literals (as the payroll page does for status labels), skip the locale files and use literals.

**Spec:**
- Add a **"ตรวจสอบ (Reconcile)"** link in the run-actions area of `/admin/payroll?m=` (the same area as `RunActionForm` / the payslip-zip button). It is an `<a href={`/admin/payroll/reconcile?m=${month}`}>` styled like the sibling secondary actions.
- **Prominence:** show it for every month that has rows, but give it visual emphasis (or place it first) when `statusCounts.Draft > 0` — that's when reconciliation matters most. Use the existing `statusCounts` object already computed on the page.

- [ ] **Step 1: Add the link** in the run-actions block, mirroring the existing action-link markup (the payslip-zip `<a>` is the template).

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npx biome check "src/app/(admin)/admin/payroll/page.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/payroll/page.tsx"
git commit -m "feat(payroll): link the reconciliation page from the run page"
```

---

## Done criteria

- `reconcile.test.ts` (unit) + `reconcile-data.integration.test.ts` (integration) green; full `pnpm test` and `pnpm test:integration` green; `npx tsc --noEmit` + `npx biome check` clean.
- `/admin/payroll/reconcile?m=` renders the summary, needs-review, derivation, and all-rows sections; the payroll page links to it.
- No schema/migration, no `prisma.*` writes anywhere in the diff (verify with a grep before the final review).
