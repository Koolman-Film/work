# Payslip PDF Preview Before Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a payroll admin preview the rendered PDF slip for a Draft row — embedded inline in the per-employee detail modal — before pressing เผยแพร่ + ส่งสลิป.

**Architecture:** Extract a pure `assemblePayslipDocument` from `getPayslipDocument` so the published path and a new draft-preview path share one document-assembly (faithfulness by construction). Add a numbers-returning `payrollRowDetailRaw` draft accessor, a `buildPreviewPayslipDocument` that feeds the shared assembler from the live draft, an admin `payroll.read`-gated route that renders the preview PDF inline (no storage persist), and a lazy iframe embed in the detail modal.

**Tech Stack:** Next.js App Router (route handlers + server components/actions), Prisma, `decimal.js`, Vitest (unit + integration vs `koolman_test`), the existing Playwright-based `renderPayslipPdf` HTML→PDF renderer, Tailwind.

## Global Constraints

- **Faithful by shared assembler:** the published path (`getPayslipDocument`) and the preview path MUST call the SAME `assemblePayslipDocument`. No second copy of the line-construction logic.
- **`getPayslipDocument` output must not change.** The existing `tests/integration/payslip-document.integration.test.ts` must stay green unchanged — it is the characterization net for the extraction.
- **Serialized `payrollRowDetail` must not change.** The shipped per-employee feature depends on it. Add `payrollRowDetailRaw` as a NEW function; do not refactor the serialized one.
- **No storage persistence for previews.** The preview route renders on-the-fly and streams bytes; it must NEVER call `getOrRenderPayslipPdf` or write the `payslips` bucket key `employeeId/month.pdf` (that key is the real published slip).
- **Preview route gate = `payroll.read`** (same permission that loads the modal breakdown). Validate `m` (MONTH_RE) and `employeeId` (UUID_RE).
- **Draft rows only.** Published/Locked modal branch is unchanged — no preview button there.
- **Lazy render:** the iframe (and its ~1.2s headless render) mounts only after the admin clicks "ดูตัวอย่างสลิป (PDF)".
- **Inline Thai copy**, matching the admin payroll surface (no `messages/*.json` keys).
- **No `Decimal` to client.** Client components receive strings/the route's PDF bytes only.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. If the `lint-staged` pre-commit hook errors with `Command "lint-staged" not found`, deps are missing — run `pnpm install` once.
- **Test commands:** unit `pnpm test`; integration `pnpm test:integration`; types `pnpm exec tsc --noEmit`; lint `pnpm lint` or `pnpm exec biome check <files>`.

**Spec:** `docs/superpowers/specs/2026-06-29-payslip-pdf-preview-before-publish-design.md`

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/payslip/document.ts` | Extract pure `assemblePayslipDocument`; `getPayslipDocument` becomes gather→normalize→assemble | 1 |
| `src/lib/payslip/document.test.ts` (new) | Unit tests for the pure assembler | 1 |
| `src/lib/payroll/run.ts` | Add `payrollRowDetailRaw` (numbers + line sources) | 2 |
| `tests/integration/payroll-pipeline.integration.test.ts` | `payrollRowDetailRaw` coverage | 2 |
| `src/lib/payslip/preview.ts` (new) | `buildPreviewPayslipDocument` (live draft → assembler) | 3 |
| `tests/integration/payslip-document.integration.test.ts` | preview-document coverage (extend existing file) | 3 |
| `src/app/(admin)/admin/payroll/preview-pdf/route.ts` (new) | admin-gated inline preview PDF, no persist, audit | 4 |
| `src/app/(admin)/admin/payroll/row-detail.tsx` | lazy preview toggle + iframe + spinner + error/retry | 5 |

---

### Task 0: Ensure dev dependencies are installed

**Files:** none (environment only)

- [ ] **Step 1: Install deps so the pre-commit hook works**

Run: `pnpm install`
Expected: completes; `node_modules/.bin/lint-staged` exists. (No-op if already installed and `git commit` works without the `lint-staged not found` error.)

---

### Task 1: Extract the pure `assemblePayslipDocument`

**Files:**
- Modify: `src/lib/payslip/document.ts`
- Create: `src/lib/payslip/document.test.ts`
- Safety net (must stay green, do not edit): `tests/integration/payslip-document.integration.test.ts`

**Interfaces:**
- Consumes: existing `PayslipDocument`, `PayslipLine` types; `perMinuteRate`, `standardDayMinutes`, `adjustmentAppliesToMonth`.
- Produces:
```ts
export type NormalizedPayslipInput = {
  meta: { employeeName: string; employeeId: string; branch: string; department: string | null; payType: 'Monthly' | 'Daily' | 'Hourly'; month: string };
  buckets: {
    incomeBase: number; incomeOther: number;
    deductSso: number; deductAdvance: number; deductAttendance: number;
    deductLeave: number; deductDebt: number; deductOther: number;
    netPay: number;
  };
  /** Income-kind adjustments that apply to this month, in display order. */
  incomeAdjustments: { id: string; reason: string; amount: number }[];
  /** Deduction-kind adjustments that apply to this month, in display order. */
  deductAdjustments: { id: string; reason: string; amount: number }[];
  /** Number of cash advances feeding deductAdvance (for the line detail count). */
  advanceCount: number;
  /** Attendance counts over the pay period (for the attendance line detail). */
  attendance: { absent: number; late: number };
  /** Sum of over-quota leave minutes (for the leave line detail). */
  leaveOverMinutesTotal: number;
  /** Inputs the assembler needs to compute the SSO% label and the leave per-minute rate. */
  rateInputs: { ssoRatePct: number; ssoSalaryCap: number; salaryType: 'Monthly' | 'Daily' | 'Hourly'; baseSalary: number; workingDaysPerMonth: number; standardDayMinutes: number };
};
export function assemblePayslipDocument(input: NormalizedPayslipInput): PayslipDocument;
```

- [ ] **Step 1: Write failing unit tests for the pure assembler**

Create `src/lib/payslip/document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';

const base: NormalizedPayslipInput = {
  meta: { employeeName: 'Somchai Jaidee', employeeId: 'e1', branch: 'HQ', department: 'Ops', payType: 'Monthly', month: '2026-06' },
  buckets: {
    incomeBase: 20000, incomeOther: 0,
    deductSso: 750, deductAdvance: 0, deductAttendance: 0,
    deductLeave: 0, deductDebt: 0, deductOther: 0, netPay: 19250,
  },
  incomeAdjustments: [], deductAdjustments: [],
  advanceCount: 0, attendance: { absent: 0, late: 0 }, leaveOverMinutesTotal: 0,
  rateInputs: { ssoRatePct: 5, ssoSalaryCap: 15000, salaryType: 'Monthly', baseSalary: 20000, workingDaysPerMonth: 30, standardDayMinutes: 420 },
};

describe('assemblePayslipDocument', () => {
  it('base salary + SSO only → totals and net reconcile', () => {
    const doc = assemblePayslipDocument(base);
    expect(doc.income.lines).toEqual([{ key: 'base', labelKey: 'income.base', amount: 20000, detail: null }]);
    expect(doc.income.total).toBe(20000);
    const sso = doc.deduct.lines.find((l) => l.key === 'sso');
    expect(sso?.amount).toBe(750);
    expect(sso?.detail).toEqual({ key: 'sso', vars: { pct: 5, cap: '15,000' } });
    expect(doc.deduct.total).toBe(750);
    expect(doc.net).toBe(19250);
  });

  it('itemizes income adjustments when they reconcile to incomeOther', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, incomeOther: 1500, netPay: 20750 },
      incomeAdjustments: [{ id: 'a1', reason: 'โบนัส', amount: 1500 }],
    });
    expect(doc.income.lines).toEqual([
      { key: 'base', labelKey: 'income.base', amount: 20000, detail: null },
      { key: 'a1', label: 'โบนัส', amount: 1500, detail: null },
    ]);
  });

  it('falls back to a single income.other line when adjustments do NOT reconcile', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, incomeOther: 1500, netPay: 20750 },
      incomeAdjustments: [{ id: 'a1', reason: 'โบนัส', amount: 1000 }], // sum 1000 != 1500
    });
    expect(doc.income.lines.some((l) => l.key === 'other' && l.amount === 1500)).toBe(true);
    expect(doc.income.lines.some((l) => l.key === 'a1')).toBe(false);
  });

  it('emits attendance + leave details from the supplied counts/minutes', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, deductAttendance: 1000, deductLeave: 200, netPay: 18050 },
      attendance: { absent: 2, late: 0 }, leaveOverMinutesTotal: 60,
    });
    const att = doc.deduct.lines.find((l) => l.key === 'attendance');
    expect(att?.detail).toEqual({ key: 'attendance', vars: { absent: 2, late: 0 } });
    const leave = doc.deduct.lines.find((l) => l.key === 'leave');
    expect(leave?.detail?.key).toBe('leave');
    expect(leave?.detail?.vars.minutes).toBe(60);
  });

  it('omits zero-amount deduction lines', () => {
    const doc = assemblePayslipDocument(base); // only SSO non-zero
    expect(doc.deduct.lines.map((l) => l.key)).toEqual(['sso']);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm test src/lib/payslip/document.test.ts`
Expected: FAIL — `assemblePayslipDocument is not exported` / not a function.

- [ ] **Step 3: Extract the assembler**

In `src/lib/payslip/document.ts`, add the `NormalizedPayslipInput` type (from Interfaces) and a pure `assemblePayslipDocument` that contains the EXISTING line-construction logic, sourced from `input` instead of from `payroll`/`config`/`employee`/DB:

```ts
export function assemblePayslipDocument(input: NormalizedPayslipInput): PayslipDocument {
  const { meta, buckets, incomeAdjustments, deductAdjustments, advanceCount, attendance, leaveOverMinutesTotal, rateInputs } = input;

  // ── Income
  const income: PayslipLine[] = [{ key: 'base', labelKey: 'income.base', amount: buckets.incomeBase, detail: null }];
  const incomeAdjSum = incomeAdjustments.reduce((s, a) => s + a.amount, 0);
  if (incomeAdjustments.length > 0 && incomeAdjSum === buckets.incomeOther) {
    for (const a of incomeAdjustments) income.push({ key: a.id, label: a.reason, amount: a.amount, detail: null });
  } else if (buckets.incomeOther !== 0) {
    income.push({ key: 'other', labelKey: 'income.other', amount: buckets.incomeOther, detail: null });
  }

  // ── Deductions
  const deduct: PayslipLine[] = [];
  const push = (key: string, labelKey: string, amount: number, detail: PayslipLine['detail'] = null) => {
    if (amount !== 0) deduct.push({ key, labelKey, amount, detail });
  };

  const ssoDetail = buckets.deductSso !== 0
    ? { key: 'sso', vars: { pct: rateInputs.ssoRatePct, cap: rateInputs.ssoSalaryCap.toLocaleString('en-US') } }
    : null;
  push('sso', 'deduct.sso', buckets.deductSso, ssoDetail);

  const advDetail = advanceCount > 0 ? { key: 'advance', vars: { count: advanceCount } } : null;
  push('advance', 'deduct.advance', buckets.deductAdvance, advDetail);

  let attDetail: PayslipLine['detail'] = null;
  if (buckets.deductAttendance !== 0 && attendance.absent + attendance.late > 0) {
    attDetail = { key: 'attendance', vars: { absent: attendance.absent, late: attendance.late } };
  }
  push('attendance', 'deduct.attendance', buckets.deductAttendance, attDetail);

  const rate = perMinuteRate(rateInputs.salaryType, rateInputs.baseSalary, rateInputs.workingDaysPerMonth, rateInputs.standardDayMinutes);
  const leaveDetail = leaveOverMinutesTotal > 0
    ? { key: 'leave', vars: { minutes: leaveOverMinutesTotal, rate: rate.toFixed(4) } }
    : null;
  push('leave', 'deduct.leave', buckets.deductLeave, leaveDetail);

  push('debt', 'deduct.debt', buckets.deductDebt);

  const deductAdjSum = deductAdjustments.reduce((s, a) => s + a.amount, 0);
  if (deductAdjustments.length > 0 && deductAdjSum === buckets.deductOther) {
    for (const a of deductAdjustments) deduct.push({ key: a.id, label: a.reason, amount: a.amount, detail: null });
  } else if (buckets.deductOther !== 0) {
    deduct.push({ key: 'other', labelKey: 'deduct.other', amount: buckets.deductOther, detail: null });
  }

  return {
    meta,
    income: { lines: income, total: buckets.incomeBase + buckets.incomeOther },
    deduct: {
      lines: deduct,
      total: buckets.deductSso + buckets.deductAdvance + buckets.deductAttendance + buckets.deductLeave + buckets.deductDebt + buckets.deductOther,
    },
    net: buckets.netPay,
  };
}
```

Then rewrite `getPayslipDocument` to build a `NormalizedPayslipInput` from its existing gathered data and `return assemblePayslipDocument(input)`. Specifically, keep ALL existing queries (the `status: Published/Locked` guard, the attendance `count` queries → `attendance: { absent, late }`, the advances list → `advanceCount: advances.length`, the leaves → `leaveOverMinutesTotal: leaves.reduce((s,l)=>s+(l.overQuotaMinutes ?? 0),0)`), compute `standardDayMinutes(leaveConfig ?? defaults)` and pass it, set `ssoRatePct: Math.round(n(config.ssoRate)*100)`, `ssoSalaryCap: n(config.ssoSalaryCap)`, and feed Income/Deduction adjustments already filtered by `adjustmentAppliesToMonth`. The function's RETURN value must be byte-identical to before.

- [ ] **Step 4: Run unit + the characterization integration test, verify all pass**

Run: `pnpm test src/lib/payslip/document.test.ts`
Expected: PASS (all 5 cases).

Run: `pnpm test:integration tests/integration/payslip-document.integration.test.ts`
Expected: PASS unchanged — proves `getPayslipDocument`'s output did not change.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payslip/document.ts src/lib/payslip/document.test.ts
git commit -m "refactor(payslip): extract pure assemblePayslipDocument

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `payrollRowDetailRaw` — one-employee draft numbers + line sources

**Files:**
- Modify: `src/lib/payroll/run.ts`
- Test: `tests/integration/payroll-pipeline.integration.test.ts`

**Interfaces:**
- Consumes: existing `gatherAndCalc(prisma, month, employeeId)` (scoped to one employee, added in the prior feature); `draft.breakdown` (with `absentCount`, `lateCount`).
- Produces:
```ts
export type PayrollRowDetailRaw = {
  buckets: {
    incomeBase: number; incomeOther: number;
    deductSso: number; deductAdvance: number; deductAttendance: number;
    deductLeave: number; deductDebt: number; deductOther: number; netPay: number;
  };
  incomeAdjustments: { id: string; reason: string; amount: number }[];
  deductAdjustments: { id: string; reason: string; amount: number }[];
  advanceCount: number;
  attendance: { absent: number; late: number };
  leaveOverMinutesTotal: number;
  employee: { salaryType: 'Monthly' | 'Daily' | 'Hourly'; baseSalary: number };
  config: { ssoRatePct: number; ssoSalaryCap: number; workingDaysPerMonth: number };
};
export async function payrollRowDetailRaw(month: string, employeeId: string): Promise<PayrollRowDetailRaw | null>;
```

This is a NEW function — do NOT modify the serialized `payrollRowDetail`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/payroll-pipeline.integration.test.ts` (reuses `reset`, `makeEmployee`, `MONTH`, `inMonth`, `uid`; import `payrollRowDetailRaw`):

```ts
describe('payrollRowDetailRaw', () => {
  beforeEach(reset);

  it('returns numeric buckets + line sources for a draft employee', async () => {
    const emp = await makeEmployee({ baseSalary: 20000, hasSso: true });
    await prisma.attendance.create({
      data: { employeeId: emp.id, date: inMonth, type: 'Absent', durationMinutes: null, source: 'Manual', createdById: uid() },
    });
    await prisma.payrollAdjustment.create({
      data: { employeeId: emp.id, kind: 'Income', reason: 'ค่าคอม', amount: new Prisma.Decimal(1000), startMonth: MONTH, endMonth: MONTH },
    });

    const raw = await payrollRowDetailRaw(MONTH, emp.id);
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(typeof raw.buckets.netPay).toBe('number');
    expect(raw.buckets.deductSso).toBe(750);
    expect(raw.attendance.absent).toBe(1);
    expect(raw.incomeAdjustments).toEqual([{ id: expect.any(String), reason: 'ค่าคอม', amount: 1000 }]);
    expect(raw.employee).toEqual({ salaryType: 'Monthly', baseSalary: 20000 });
    expect(raw.config.ssoRatePct).toBe(5);
    // 20000 + 1000 - 750(sso) - 500(absent) = 19750
    expect(raw.buckets.netPay).toBe(19750);
  });

  it('returns null when no computable row exists', async () => {
    expect(await payrollRowDetailRaw(MONTH, uid())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts -t payrollRowDetailRaw`
Expected: FAIL — `payrollRowDetailRaw is not a function`.

- [ ] **Step 3: Implement `payrollRowDetailRaw`**

Add to `src/lib/payroll/run.ts`. It gathers the one employee, reads the draft + breakdown, and queries the per-month applicable adjustments (same query shape `payrollRowDetail` already uses), splitting by kind. Advance count comes from the gathered `sweptAdvanceIds.length`; leave minutes from the gathered `sweptLeaves`. Employee salary/base and config come from the gather's loaded rows — if `gatherAndCalc` does not return them, query `payrollConfig` + the employee here.

```ts
export async function payrollRowDetailRaw(
  month: string,
  employeeId: string,
): Promise<PayrollRowDetailRaw | null> {
  const { drafts } = await gatherAndCalc(prisma, month, employeeId);
  const entry = drafts[0];
  if (!entry) return null;
  const { draft } = entry;
  const b = draft.breakdown;

  const [config, employee, adjustments] = await Promise.all([
    prisma.payrollConfig.findFirstOrThrow({ select: { ssoRate: true, ssoSalaryCap: true, workingDaysPerMonth: true } }),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { salaryType: true, baseSalary: true } }),
    prisma.payrollAdjustment.findMany({
      where: { employeeId, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }], deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, reason: true, amount: true, startMonth: true, endMonth: true },
    }),
  ]);
  const applicable = adjustments.filter((a) => adjustmentAppliesToMonth(a, month));
  const mapAdj = (kind: 'Income' | 'Deduction') =>
    applicable.filter((a) => a.kind === kind).map((a) => ({ id: a.id, reason: a.reason, amount: a.amount.toNumber() }));

  return {
    buckets: {
      incomeBase: draft.incomeBase.toNumber(), incomeOther: draft.incomeOther.toNumber(),
      deductSso: draft.deductSso.toNumber(), deductAdvance: draft.deductAdvance.toNumber(),
      deductAttendance: draft.deductAttendance.toNumber(), deductLeave: draft.deductLeave.toNumber(),
      deductDebt: draft.deductDebt.toNumber(), deductOther: draft.deductOther.toNumber(),
      netPay: draft.netPay.toNumber(),
    },
    incomeAdjustments: mapAdj('Income'),
    deductAdjustments: mapAdj('Deduction'),
    advanceCount: entry.sweptAdvanceIds.length,
    attendance: { absent: b.absentCount, late: b.lateCount },
    leaveOverMinutesTotal: entry.sweptLeaves.reduce((s, l) => s + l.over, 0),
    employee: { salaryType: employee.salaryType as 'Monthly' | 'Daily' | 'Hourly', baseSalary: employee.baseSalary.toNumber() },
    config: { ssoRatePct: Math.round(config.ssoRate.toNumber() * 100), ssoSalaryCap: config.ssoSalaryCap.toNumber(), workingDaysPerMonth: config.workingDaysPerMonth },
  };
}
```

Add the `PayrollRowDetailRaw` type export near the other run.ts exports. `adjustmentAppliesToMonth` is already imported in run.ts.

- [ ] **Step 4: Run the test, verify pass; then the whole integration file**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts`
Expected: PASS — new `payrollRowDetailRaw` cases green AND all pre-existing cases (incl. serialized `payrollRowDetail`, which is untouched) still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/run.ts tests/integration/payroll-pipeline.integration.test.ts
git commit -m "feat(payroll): payrollRowDetailRaw — numeric draft view for previews

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `buildPreviewPayslipDocument` — live draft → shared assembler

**Files:**
- Create: `src/lib/payslip/preview.ts`
- Test: `tests/integration/payslip-document.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `payrollRowDetailRaw` (Task 2), `assemblePayslipDocument` + `NormalizedPayslipInput` (Task 1), `standardDayMinutes`, existing `prisma`.
- Produces: `export async function buildPreviewPayslipDocument(month: string, employeeId: string): Promise<PayslipDocument | null>;`

- [ ] **Step 1: Write the failing integration test**

First READ `tests/integration/payslip-document.integration.test.ts` to learn how it seeds an employee + payroll + `payrollConfig`/`leaveConfig`/branch (the existing `getPayslipDocument` tests there need all of these). Reuse that exact setup, with ONE difference: do NOT publish — `buildPreviewPayslipDocument` reads the live Draft, so the employee just needs to be non-archived Monthly with `payrollConfig` + `leaveConfig` present (what `gatherAndCalc` requires). Add:

```ts
describe('buildPreviewPayslipDocument', () => {
  it('builds a faithful document from the live draft', async () => {
    // Build a non-archived Monthly employee with a known base salary, reusing this
    // file's existing seed setup (payrollConfig + leaveConfig + branch). Do NOT publish.
    // Compute the expected net from the same inputs (e.g. base 20000, hasSso → -750 SSO,
    // no attendance/leave/advance → net 19250). Adjust the literals to match your fixture.
    const { employeeId } = await seedMonthlyEmployee({ baseSalary: 20000, hasSso: true }); // ← this file's helper name
    const month = '2026-06';

    const doc = await buildPreviewPayslipDocument(month, employeeId);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.meta.employeeId).toBe(employeeId);
    expect(doc.income.lines[0]).toEqual({ key: 'base', labelKey: 'income.base', amount: 20000, detail: null });
    expect(doc.net).toBe(19250); // 20000 - 750 SSO, no other deductions
  });

  it('returns null for an employee with no computable draft', async () => {
    expect(await buildPreviewPayslipDocument('2026-06', crypto.randomUUID())).toBeNull();
  });
});
```

Replace `seedMonthlyEmployee(...)` and the literals with the actual helper/fixture this file uses (you read it in this step) and the net those inputs produce. The point of the assertion is: the preview document's `net` and base-income line equal what the draft computes — proving the preview is faithful without publishing.

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm test:integration tests/integration/payslip-document.integration.test.ts -t buildPreviewPayslipDocument`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement `buildPreviewPayslipDocument`**

Create `src/lib/payslip/preview.ts`:

```ts
import { prisma } from '@/lib/db/prisma';
import { standardDayMinutes } from '@/lib/leave/units';
import { payrollRowDetailRaw } from '@/lib/payroll/run';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';
import type { PayslipDocument } from './types';

const LEAVE_DEFAULTS = { morningStart: '09:00', morningEnd: '12:00', afternoonStart: '13:00', afternoonEnd: '17:00' };

export async function buildPreviewPayslipDocument(
  month: string,
  employeeId: string,
): Promise<PayslipDocument | null> {
  const raw = await payrollRowDetailRaw(month, employeeId);
  if (!raw) return null;

  const [employee, leaveConfig] = await Promise.all([
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, branch: { select: { name: true } }, department: { select: { name: true } } },
    }),
    prisma.leaveConfig.findFirst(),
  ]);

  const input: NormalizedPayslipInput = {
    meta: {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeId,
      branch: employee.branch.name,
      department: employee.department?.name ?? null,
      payType: raw.employee.salaryType,
      month,
    },
    buckets: raw.buckets,
    incomeAdjustments: raw.incomeAdjustments,
    deductAdjustments: raw.deductAdjustments,
    advanceCount: raw.advanceCount,
    attendance: raw.attendance,
    leaveOverMinutesTotal: raw.leaveOverMinutesTotal,
    rateInputs: {
      ssoRatePct: raw.config.ssoRatePct,
      ssoSalaryCap: raw.config.ssoSalaryCap,
      salaryType: raw.employee.salaryType,
      baseSalary: raw.employee.baseSalary,
      workingDaysPerMonth: raw.config.workingDaysPerMonth,
      standardDayMinutes: standardDayMinutes(leaveConfig ?? LEAVE_DEFAULTS),
    },
  };
  return assemblePayslipDocument(input);
}
```

- [ ] **Step 4: Run the test, verify pass; then the whole file**

Run: `pnpm test:integration tests/integration/payslip-document.integration.test.ts`
Expected: PASS — new preview cases green AND the existing `getPayslipDocument` characterization cases still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payslip/preview.ts tests/integration/payslip-document.integration.test.ts
git commit -m "feat(payslip): buildPreviewPayslipDocument from live draft

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Admin preview-PDF route (inline, no persist, audited)

**Files:**
- Create: `src/app/(admin)/admin/payroll/preview-pdf/route.ts`
- Reference (mirror its render call): `src/app/(liff)/liff/payslip/pdf/route.ts`

**Interfaces:**
- Consumes: `buildPreviewPayslipDocument` (Task 3); `requirePermission`, `auditLog`, `buildPayslipHtml`, `renderPayslipPdf`, `fontFaceCss`, `payslipLogoSvg`, `payslipPeriodLabel`, `formatMoney`, `getLocale`/`getTranslations`.
- Produces: `GET /admin/payroll/preview-pdf?m=YYYY-MM&employeeId=<uuid>` → inline `application/pdf` (200) | 400 | 404 | 500.

- [ ] **Step 1: Implement the route**

Create `src/app/(admin)/admin/payroll/preview-pdf/route.ts` (mirrors the employee route's render but: admin gate, draft document, inline bytes, NO storage):

```ts
import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { payslipLogoSvg, payslipPeriodLabel } from '@/lib/payslip/letterhead';
import { renderPayslipPdf } from '@/lib/payslip/pdf';
import { buildPreviewPayslipDocument } from '@/lib/payslip/preview';
import { buildPayslipHtml } from '@/lib/payslip/render-html';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request): Promise<Response> {
  const { user } = await requirePermission('payroll.read');

  const url = new URL(req.url);
  const month = url.searchParams.get('m') ?? '';
  const employeeId = url.searchParams.get('employeeId') ?? '';
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const doc = await buildPreviewPayslipDocument(month, employeeId);
  if (!doc) return new NextResponse('No computable draft', { status: 404 });

  try {
    const locale = await getLocale();
    const [t, tEn] = await Promise.all([getTranslations({ locale }), getTranslations({ locale: 'en' })]);
    const buf = await renderPayslipPdf(
      buildPayslipHtml(doc, {
        locale,
        t: (k, v) => t(k as Parameters<typeof t>[0], v as Parameters<typeof t>[1]),
        tEn: (k) => tEn(k as Parameters<typeof tEn>[0]),
        money: (n) => formatMoney(n, locale as Locale),
        fontFace: fontFaceCss(locale),
        logoSvg: payslipLogoSvg(),
        periodLabel: payslipPeriodLabel(locale, month),
        generatedAt: new Date().toISOString(),
      }),
    );

    auditLog({
      actorId: user.id,
      action: 'payslip.preview',
      entityType: 'Payroll',
      entityId: `${employeeId}:${month}`,
      metadata: { source: 'admin-ui', month, employeeId },
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[payslip-preview-pdf] render failed', {
      employeeId, month, error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
}
```

Note: must NOT import or call `getOrRenderPayslipPdf` — preview never persists. `Cache-Control: no-store` keeps browsers from caching a stale draft preview.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.
Run: `pnpm exec biome check "src/app/(admin)/admin/payroll/preview-pdf/route.ts"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/payroll/preview-pdf/route.ts"
git commit -m "feat(payroll): admin preview-pdf route (inline draft slip, no persist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Embed the preview in the detail modal (lazy iframe)

**Files:**
- Modify: `src/app/(admin)/admin/payroll/row-detail.tsx`

**Interfaces:**
- Consumes: the route `GET /admin/payroll/preview-pdf?m=&employeeId=`; existing `month`, `employeeId`, `status`, `Button` already in `RowDetail`.
- Produces: a lazy preview toggle + iframe in the Draft branch only.

- [ ] **Step 1: Add the preview toggle + iframe to the Draft branch**

In `row-detail.tsx`, inside the `status === 'Draft' && detail` branch, AFTER the breakdown sections and BEFORE the `ConfirmDialog` publish button block, add a lazy preview. Add state near the existing `detail`/`loading` state:

```tsx
const [showPreview, setShowPreview] = useState(false);
const [previewLoading, setPreviewLoading] = useState(false);
const [previewKey, setPreviewKey] = useState(0); // bump to retry (re-mounts the iframe)
```

Render (inside the Draft branch, after the breakdown, before the publish button):

```tsx
<div className="mt-4 border-t border-gray-100 pt-3">
  {!showPreview ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => { setShowPreview(true); setPreviewLoading(true); }}
    >
      ดูตัวอย่างสลิป (PDF)
    </Button>
  ) : (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-3">ตัวอย่างสลิป (PDF)</p>
        {/* Honest retry: a 500/blank from the route still "loads" into the iframe,
            so we cannot reliably auto-detect failure — give a manual reload that
            re-mounts the iframe by bumping its key. */}
        <button
          type="button"
          onClick={() => { setPreviewKey((k) => k + 1); setPreviewLoading(true); }}
          className="rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
        >
          โหลดใหม่
        </button>
      </div>
      <div className="relative">
        {previewLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-white/80">
            <div className="flex flex-col items-center gap-2">
              <span className="size-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" aria-hidden="true" />
              <p className="text-xs text-ink-3">กำลังสร้างตัวอย่างสลิป…</p>
            </div>
          </div>
        )}
        <iframe
          key={previewKey}
          title="ตัวอย่างสลิปเงินเดือน"
          src={`/admin/payroll/preview-pdf?m=${month}&employeeId=${employeeId}`}
          className="h-[60vh] w-full rounded-lg border border-gray-200"
          onLoad={() => setPreviewLoading(false)}
        />
      </div>
    </div>
  )}
</div>
```

Keep the publish `ConfirmDialog` block exactly as-is below this. Do NOT add the preview to the frozen (Published/Locked) branch or the empty/loading/error states.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.
Run: `pnpm exec biome check "src/app/(admin)/admin/payroll/row-detail.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/payroll/row-detail.tsx"
git commit -m "feat(payroll): embed lazy PDF preview in the per-employee detail modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual verification (controller/user — interactive)**

NOT done by the implementer. On the local stack: open `/admin/payroll`, คำนวณ, open a Draft row's ดูรายละเอียด, click **ดูตัวอย่างสลิป (PDF)** → the rendered slip PDF appears inline (spinner then PDF); numbers match the breakdown; pressing เผยแพร่ still works. Confirm a Published/Locked row's modal has NO preview button.

---

### Task 6: Full regression sweep

**Files:** none (verification)

- [ ] **Step 1: Unit suite**

Run: `pnpm test`
Expected: PASS (incl. the new `document.test.ts`).

- [ ] **Step 2: Integration suite**

Run: `pnpm test:integration`
Expected: PASS (incl. `payrollRowDetailRaw` + `buildPreviewPayslipDocument`; the existing `payslip-document` + `payslip-pdf` cases still green).

- [ ] **Step 3: Types + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean. Fix anything surfaced, re-run, done.
