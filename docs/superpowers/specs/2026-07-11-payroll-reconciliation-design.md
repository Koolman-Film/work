# Payroll Run Reconciliation — Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

A **pre-publish reconciliation view** for a payroll month: a dedicated admin
page that helps the payroll admin *catch errors before money moves*. It surfaces
the **exceptions** — employees whose pay swung, who are new or missing from the
run, whose deductions spiked, or whose net is zero/negative — so the admin
eyeballs outliers instead of scanning all ~49 rows, then fixes and re-runs
before publishing.

It is a **pure read-only, derived view**: everything is computed live from data
the app already freezes (`Payroll` breakdown columns, prior frozen months,
`PayrollAdjustment` rows). **No schema changes, no migration, no writes, no
audit rows** — fully additive/non-destructive, and cheap to unit-test because
the logic is pure functions.

## Context (what already exists)

- **`Payroll`** (`prisma/schema.prisma:691`): one row per `employeeId` + `month`
  (`"YYYY-MM"`), storing the full gross→net breakdown: `incomeBase`,
  `incomeOther`, and six deductions (`deductSso`, `deductAdvance`,
  `deductAttendance`, `deductLeave`, `deductDebt`, `deductOther`), `netPay`,
  `status` (`Draft`/`Published`/`Locked`), `publishedAt`, and a `revisionOf`
  self-relation. `@@unique([employeeId, month])`, `@@index([month])`.
- **`PayrollAdjustment`** (`prisma/schema.prisma:673`): `kind` (income/deduction),
  `reason`, `amount`, `startMonth`/`endMonth`, soft-delete (`deletedAt`).
  Income-kind adjustments land in `Payroll.incomeOther`; deduction-kind in
  `deductOther`. Already audited via the general audit log; CRUD gated on
  `payroll.run`.
- **Payroll permissions are global-only** (`PAYROLL_PERMISSIONS`, enforced by
  `payroll-gates.test.ts`): payroll surfaces gate with
  `requireGlobalPermission`, never a bare `requirePermission`. There is **no**
  per-branch scoping of payroll — a payroll admin sees all branches.
- **Existing payroll surface:** `/admin/payroll?m=YYYY-MM`
  (`requireGlobalPermission('payroll.read')`) lists every row for the month with
  a per-row HTML-preview modal. Run/publish actions live in
  `admin/payroll/actions.ts` (gated `payroll.run` / `payroll.publish`).
- **Formatting helpers:** `formatTHB2`, `monthLabelTh` from `@/lib/format`
  (Buddhist-era month label + 2-dp THB) — used by the payroll page and the
  payslip surfaces.
- **Reports today** cover attendance/advance/leave only — there is **no
  payroll/financial view**. This feature also delivers the most valuable slice
  of "reporting depth": run totals + net payout by branch.

## Decisions

1. **Primary job = pre-publish sanity check.** The view exists to give the admin
   confidence to publish a Draft run. Its emphasis is anomaly-catching, not
   post-hoc lookup (though it works after publish too, since the data is the same).
2. **Dedicated page**, not inline badges or a forced publish step:
   `/admin/payroll/reconcile?m=YYYY-MM`, linked prominently from the run page
   (especially while the month is Draft).
3. **Advisory, not gating.** It never blocks publish. Each flagged row instead
   **links to where you'd fix it** (the employee's adjustments, or the employee
   record), so review → fix → re-run stays fast.
4. **Read-only, derived, zero-schema.** No new tables/columns, no writes, no
   audit rows. Live computation over existing `Payroll` / `PayrollAdjustment`.
5. **Global-only access.** `requireGlobalPermission('payroll.read')`, consistent
   with every other payroll surface (no per-branch scoping).
6. **Thresholds are hardcoded constants** (one module), not admin-configurable.
   UI configurability is a clean phase-2 (YAGNI now).

## Non-goals (explicit YAGNI)

- Admin-configurable thresholds / a settings UI for the rules.
- Any persisted "reviewed / acknowledged" state or sign-off workflow (the view
  is stateless).
- Blocking or gating the publish action.
- Editing adjustments/payroll *from* this page (it links out to the existing
  edit surfaces).
- Post-hoc, employee-facing "why did my pay change" surface (admin-only for now).
- Broad dashboard analytics beyond this run (headcount trends, leave liability,
  multi-month cost charts) — separate future work.
- Statistical/peer-relative anomaly detection — fixed-threshold rules only.

## Anomaly engine

**Baseline** for an employee = their **most recent Published/Locked `Payroll`
before `month`** (skips gaps: if May is the last frozen month, it is the
baseline for July). An employee may have **no** baseline (never paid before).

Rules (v1 defaults; all constants live in `RECONCILE_THRESHOLDS`):

| Flag | Rule | Severity | Chip example |
|---|---|---|---|
| **Zero / negative net** | `netPay ≤ 0` | 1 (highest) | "net ≤ 0" |
| **Missing from run** | employee is Active (non-archived) **with a frozen baseline**, but has no `Payroll` row this month | 2 | "missing from run" |
| **Low net** | `netPay < 0.5 × gross` where `gross = incomeBase + incomeOther` (and gross > 0) | 3 | "net unusually low" |
| **Big net swing** | baseline exists **and** `|Δnet| ≥ SWING_MIN (฿1,000)` **and** `|Δnet| ≥ SWING_PCT (20%) × baseline.netPay` | 4 | "net −35% vs พ.ค." |
| **New this month** | has a row this month **and** no prior frozen `Payroll` at all | 5 | "first payslip" |
| **Deduction spike / appeared** | for any deduction column: `baseline = 0 && current > 0`, **or** `current − baseline ≥ DEDUCTION_JUMP (฿2,000)` | 6 | "attendance ฿6,600 (was ฿0)" — one chip per component |

- A row can carry **multiple chips**; it is sorted by its highest-severity
  (lowest-number) chip, then by descending `|Δnet|`.
- Constants: `SWING_PCT = 0.20`, `SWING_MIN = 1000`, `LOW_NET_PCT = 0.50`,
  `DEDUCTION_JUMP = 2000`. Tunable in one place.
- "Missing from run" is the only rule that needs the **Active-employee roster**
  (not just this month's `Payroll` rows), so the loader left-joins active
  employees against the month.

## Architecture

### Pure logic — `src/lib/payroll/reconcile.ts` (server-agnostic)

```ts
export const RECONCILE_THRESHOLDS = {
  swingPct: 0.2, swingMin: 1000, lowNetPct: 0.5, deductionJump: 2000,
} as const;

export type ReconcileFlag =
  | { kind: 'net-nonpositive' }
  | { kind: 'missing-from-run' }
  | { kind: 'low-net' }
  | { kind: 'net-swing'; deltaAbs: number; deltaPct: number; baselineMonth: string }
  | { kind: 'new-this-month' }
  | { kind: 'deduction-jump'; component: DeductionComponent; from: number; to: number };

// The six numeric breakdown fields, as plain numbers (Decimal → number at the loader).
export type PayrollBreakdown = {
  incomeBase: number; incomeOther: number;
  deductSso: number; deductAdvance: number; deductAttendance: number;
  deductLeave: number; deductDebt: number; deductOther: number;
  netPay: number;
};

// current may be null (employee missing from the run); baseline may be null (never paid).
export function flagRow(
  current: PayrollBreakdown | null,
  baseline: (PayrollBreakdown & { month: string }) | null,
  t?: typeof RECONCILE_THRESHOLDS,
): ReconcileFlag[];

export function severityRank(flag: ReconcileFlag): number; // 1..6 per the table
export function sortFlaggedRows(rows: FlaggedRow[]): FlaggedRow[]; // by top severity, then |Δnet|
```

Pure functions over plain numbers → exhaustively unit-testable (each rule,
boundary values, multi-chip rows, null-baseline, null-current).

### Data loader — `src/lib/payroll/reconcile-data.ts` (server-only)

```ts
export type ReconciliationView = {
  month: string;
  status: 'Draft' | 'Published' | 'Locked' | 'None';
  totals: { gross: number; deductions: number; net: number; headcount: number };
  byBranch: { branchId: string; branchName: string; net: number; headcount: number }[];
  rows: ReconRow[]; // every active employee + everyone with a row this month
};
export type ReconRow = {
  employeeId: string; name: string; branchName: string;
  current: PayrollBreakdown | null;      // null → missing from run
  baseline: (PayrollBreakdown & { month: string }) | null;
  adjustments: { kind: 'Income' | 'Deduction'; reason: string; amount: number }[];
  flags: ReconcileFlag[];                // from flagRow()
};

export async function loadReconciliation(month: string): Promise<ReconciliationView>;
```

Loads: this month's `Payroll` rows; each employee's most-recent frozen baseline
(latest Published/Locked `month < :month`); the active-employee roster; the
month's non-deleted `PayrollAdjustment` rows. Converts `Decimal → number`,
computes flags, accumulates run + per-branch totals. Integration-tested
(only-frozen baseline chosen, missing detection, branch subtotals, adjustment
attribution).

### Page — `src/app/(admin)/admin/payroll/reconcile/page.tsx`

- `requireGlobalPermission('payroll.read')`; read + validate `?m=YYYY-MM`
  (`MONTH_RE`); call `loadReconciliation`; render four sections:
  1. **Run summary** — status, headcount, gross / deductions / net; **net by
     branch** table.
  2. **Needs review** — only flagged rows, `sortFlaggedRows` order; each shows
     name + branch, `netPay` this month vs baseline with Δ (abs + %), a chip per
     flag, and a **fix link** (→ employee adjustments / employee record). Empty →
     green "nothing unusual — N rows, all within range".
  3. **Per-employee derivation** — expandable: the eight breakdown lines
     side-by-side with baseline (changed lines highlighted) + the contributing
     `PayrollAdjustment` rows.
  4. **All rows** — full roster, same format, collapsed by default.
- Server component; expand/collapse is a small client child.
- A **"ตรวจสอบ (Reconcile)"** link on `/admin/payroll?m=`, prominent while Draft.

Formatting via `@/lib/format` (`formatTHB2`, `monthLabelTh`); branch names via
the existing branch load. New i18n keys only for chip/section labels.

## Error / empty states

- No `Payroll` rows and no active employees for the month → empty state.
- Malformed `?m=` → `notFound()` (or redirect to the current month).
- No flagged rows → green "all within range" state (the happy path).
- An employee with no baseline is never flagged for swing/deduction-jump (those
  require a baseline); they surface only via "new this month" / net rules.

## Testing

- **Unit (`reconcile.test.ts`, thorough):** each rule at/around its threshold
  (net = 0 and < 0; net just under/over 50% gross; swing at exactly ฿1,000 and
  20%; deduction 0→>0 and the ฿2,000 jump; new vs missing; null current / null
  baseline); multi-chip rows; `severityRank` + `sortFlaggedRows` ordering.
- **Integration (`reconcile-data.integration.test.ts`):** baseline picks the
  latest *frozen* month (ignores a newer Draft, skips gaps); "missing from run"
  detects an active employee with a baseline but no current row; excludes
  archived employees; per-branch subtotals and run totals correct; adjustments
  attributed to the right employee/month.
- Page verified via tsc + lint + manual (same posture as recent features). No
  reversibility surface (read-only).

## Files

**New**
- `src/lib/payroll/reconcile.ts` — thresholds, `flagRow`, `severityRank`,
  `sortFlaggedRows`, types (+ `reconcile.test.ts`).
- `src/lib/payroll/reconcile-data.ts` — `loadReconciliation` + view types
  (+ `reconcile-data.integration.test.ts`).
- `src/app/(admin)/admin/payroll/reconcile/page.tsx` — the review page.
- Expand/collapse client child component (co-located).

**Modified**
- `src/app/(admin)/admin/payroll/page.tsx` — add the "Reconcile" link (prominent
  while Draft).
- Locale files — chip/section labels.

## Phase 2 (deferred, no rework implied)

- Admin-configurable thresholds (settings UI).
- Broader payroll dashboard: multi-month cost trend, headcount, leave liability.
- Post-hoc, employee-facing "why did my pay change" explainer.
- A persisted per-run "reviewed" acknowledgement / sign-off.
