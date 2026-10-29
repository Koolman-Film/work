# Per-Branch Payroll Cut-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a branch override the company payroll cut-off (incl. "end of month") from a named month, so Central Audio cuts on the last day of the month starting 2026-10, with no gap or overlap at the switch.

**Architecture:** A pure `CutoffRule` (global day + optional branch override with an effective-from month) replaces the bare `cutoffDay: number` everywhere a payroll window is computed. A month's window is *(previous month's end + 1) .. (this month's end)*, where each month's end comes from whichever rule applies to that month — so a transition month is stretched or shortened automatically and windows are always contiguous. Every consumer resolves the rule for the employee's **home branch** (`Employee.branchId`).

**Tech Stack:** Next.js server actions, Prisma/Postgres, Vitest, zod.

**Spec:** Customer decisions (2026-10-29 chat): only Central Audio cuts at month end; effective October 2026; pay date undecided (not modelled); blackout stays company-wide (currently 0).

## Global Constraints

- Deploying the migration must change no money: both new columns nullable; NULL = inherit `PayrollConfig.cutoffDay`.
- Hand-author migration `prisma/migrations/0052_branch_payroll_cutoff/migration.sql` (do NOT use `migrate dev --create-only`, it emits spurious DROP DEFAULTs).
- Branch cut-off value: integer 1–28, or `31` = "last day of month" (`END_OF_MONTH`). 29/30 rejected.
- Effective-from is a `YYYY-MM` string; both columns set or both NULL (DB CHECK).
- Existing callers passing a plain number must behave byte-identically (all existing period tests stay green unchanged).
- Thai UI copy: label `รอบตัดเงินเดือน`, options `ตามค่าบริษัท (วันที่ N)`, `วันที่ 1`…`วันที่ 28`, `สิ้นเดือน`; effective field `มีผลตั้งแต่รอบเดือน`.
- Branch edits that touch cut-off must write an AuditLog with before/after.

## Review Focus

1. Transition month for Central: `2026-10` must be **2026-09-27 .. 2026-10-31** (35 days), `2026-09` unchanged (08-27..09-26), `2026-11` = 11-01..11-30.
2. February under end-of-month: `2027-02` = 02-01..02-28; `2028-02` ends 02-29.
3. `monthForDate` on a transition-window date (2026-09-28 for Central) must return `2026-10`, not `2026-09` — void/correct-time/leave use it to find the frozen month.
4. Payroll run with mixed branches: a Central employee's Oct 27–31 late is charged in `2026-10`; a เชียงใหม่ employee's Oct 27–31 late is NOT (stays for `2026-11`).
5. Moving the override back later (31 → 25 from 2027-01) yields a short `2027-01` = 01-01..01-25, never overlap.

---

### Task 1: Pure cut-off rule

**Files:**
- Create: `src/lib/payroll/cutoff-rule.ts`, `src/lib/payroll/cutoff-rule.test.ts`

**Interfaces — Produces:**
```ts
export const END_OF_MONTH = 31;
export type BranchCutoff = { cutoffDay: number; fromMonth: string }; // 1–28 | 31
export type CutoffRule = { globalCutoffDay: number; branch: BranchCutoff | null };
export type Cutoff = number | CutoffRule;          // number = uniform (legacy callers)
export function toRule(c: Cutoff): CutoffRule;      // throws on invalid global/branch values
export function cutoffDayForMonth(month: string, c: Cutoff): number;
export function periodWindowYmd(month: string, c: Cutoff): { from: string; to: string };
export function periodContaining(ymd: string, c: Cutoff): { start: string; end: string; month: string };
export function isValidBranchCutoffDay(n: number): boolean;
export function describeCutoffDay(n: number): string; // 'สิ้นเดือน' | 'วันที่ N'
```
Month end = `min(cutoffDayForMonth, daysInMonth)`; `from` = previous month's end + 1 day.

- [ ] Tests: Review Focus 1, 2, 3, 5; number input equals old `payrollMonthWindowYmd` for cutoff 25/26 across a year incl. Jan/Dec; `toRule(29)` / branch 30 throw; `periodContaining` for every day of 2026-09..2026-12 returns a window that contains it (contiguity property).
- [ ] Implement; run `pnpm vitest run src/lib/payroll/cutoff-rule.test.ts` → PASS. Commit.

### Task 2: Route existing helpers through the rule

**Files:** Modify `src/lib/payroll/period.ts`, `src/lib/advance/period-earnings.ts` (`payrollPeriodFor`), `src/lib/advance/blackout.ts`, `src/lib/reports/period.ts`.

- Widen `cutoffDay: number` params to `Cutoff`. `payrollMonthWindow` / `payrollMonthWindowYmd` / `payrollPeriodLabel` delegate to `periodWindowYmd`; `payrollPeriodFor` to `periodContaining`.
- Blackout: window = `blackoutDays` days ending on the end day of the period containing today, same month only, still fail-open (catch → false).
- `resolveReportPeriod(..., cutoff?: Cutoff)`: aligned when a valid rule/number is given.
- [ ] Tests: existing suites unchanged & green; add blackout case `isInAdvanceBlackout('2026-10-30', centralRule, 3) === true`, `('2026-10-26', centralRule, 3) === false`. Commit.

### Task 3: Schema, loader, branch settings

**Files:** `prisma/schema.prisma` (Branch), `prisma/migrations/0052_branch_payroll_cutoff/migration.sql`, Create `src/lib/payroll/cutoff-load.ts`, Modify `src/app/(admin)/admin/settings/branches/{actions.ts,branch-form.tsx,[id]/page.tsx}`.

- Columns: `payrollCutoffDay Int?`, `payrollCutoffFrom String?` + CHECK `(both null) or (day in 1..28 or day = 31) and from ~ '^\d{4}-(0[1-9]|1[0-2])$'`.
- Loader:
```ts
export const DEFAULT_CUTOFF_DAY = 25;
export async function loadCutoffRules(db?): Promise<{ globalCutoffDay: number; forBranch(branchId: string | null | undefined): CutoffRule }>;
export async function loadCutoffForEmployee(employeeId: string, db?): Promise<CutoffRule>;
```
- Form: select + month input; action validates with zod (`isValidBranchCutoffDay`, YM regex), both-or-neither, audit before/after.
- [ ] Apply migration locally, `pnpm prisma generate`, typecheck. Commit.

### Task 4: Payroll run + payslip document per employee

**Files:** `src/lib/payroll/run.ts` (`gatherAndCalc`), `src/lib/payslip/document.ts`.

- `gatherAndCalc`: select `branchId`; window per employee via `rules.forBranch(emp.branchId)`; DB range queries use union bounds (min start, max end); every per-employee use (attendance, leave ranges, leave-date clamp, advance sweep `<= end`, leave sweep `startDate <= end`, derived-absence day loop) filters to that employee's own window.
- Payslip attendance counts use the employee's rule.
- [ ] Integration test (`tests/integration/…payroll-branch-cutoff.test.ts`): Review Focus 4. Run integration suite for payroll. Commit.

### Task 5: Remaining consumers

Per-employee (`loadCutoffForEmployee`): `advance/available.ts`, `advance/actions.ts`, `liff/advance/new/page.tsx`, `liff/summary/page.tsx`, `attendance/{correct-time,void,absence-preview,backfill-leave-late}.ts`, `leave/admin.ts`, admin manual-attendance page/form (pass per-employee rule map to the client form).
Org-wide: reports use `forBranch(branchId filter)` (global when unfiltered); payroll page label shows the global window plus one line per overriding branch; LIFF admin reports use global.
- [ ] Add a guard test `src/lib/payroll/cutoff-guard.test.ts` that greps `src/` (non-test) for `.cutoffDay` reads outside `cutoff-load.ts` and the settings/attendance pages and fails if any appear. Commit.

### Task 6: Verify
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, payroll integration suite. Whole-branch review. Do not push.
