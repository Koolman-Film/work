# สปส.1-10 Monthly SSO Contribution Export — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

A monthly **Social Security (สปส.1-10)** contribution export: for a chosen
**month + branch**, produce an **Excel `.xlsx`** file in the SSO e-Service upload
layout, listing each insured employee's national ID, name, wages, and
contribution, plus the summary totals. The admin reviews on screen, downloads the
file, and uploads it to the SSO e-Service portal themselves (generate → review →
export; never auto-submitted).

This is the first **statutory filing export** built, chosen ahead of ภ.ง.ด.1
(PND1) because the SSO **contribution amount already exists** in the app
(`deductSso` is computed every payroll month), whereas PND1's withheld-tax figure
is not computed anywhere. Employer registration is **per branch** (each branch
has its own SSO establishment account), so the export is scoped and generated
one file per branch per month.

## Context (what already exists)

- **`Payroll`** (`prisma/schema.prisma:684`): one row per `employeeId` + `month`
  (`"YYYY-MM"`). Stores `incomeBase`, `incomeOther`, `deductSso` (the employee's
  monthly SSO contribution), other deductions, `netPay`, `status`
  (`Draft`/`Published`/`Locked`). **No** withholding-tax field.
- **`calcSsoParts(baseSalary, config)`** (`src/lib/payroll/calc.ts:300`) — the SSO
  calculation: `applied = min(min(base, ssoSalaryCap) × ssoRate, ssoAmountCap)`,
  2 dp. Rate and caps come from `PayrollConfig` (singleton) — **config-driven**,
  so the 2026 wage-ceiling change (15,000 → 17,500) is a config update, not code.
- **Month → rows:** `prisma.payroll.findMany({ where: { month }, include: { employee } })`
  is the established per-month load (`admin/payroll/page.tsx:110`).
- **`Employee`** (`prisma/schema.prisma:374`): has `firstName`, `lastName`,
  `hasSso` (boolean), `branchId` (home branch), `status`. **No** `nationalId`,
  title, or nationality.
- **`Branch`** (`prisma/schema.prisma:292`): has payslip letterhead fields
  (`payslipNameNative`, `payslipNameEn`, `address`, logo). **No** SSO account no.
- **Export pattern:** `admin/reports/[report]/export/route.ts` — a `nodejs`
  GET route, permission-gated, builds an `ExportTable` and streams via
  `NextResponse` with `Content-Type` + RFC-5987 `Content-Disposition`; xlsx via
  `src/lib/export/xlsx.ts` (`toXlsx`); triggered by `<a href download>` links
  (`admin/reports/export-buttons.tsx`).

## Decisions

1. **Output = Excel `.xlsx`** in the SSO e-Service upload layout (what PEAK/iTAX
   do; e-Service accepts `.xls`/`.xlsx`). Not the legacy 135-char fixed-width
   text file (its byte positions are unverified from primary sources).
2. **Per branch.** Each branch files its own สปส.1-10 under its own SSO account.
   The employer SSO account number lives on `Branch`; the export is scoped to one
   branch and generates one file per branch per month.
3. **Reuse, don't recompute.** Employee contribution = the stored `deductSso`;
   employer contribution = the same 5% on the same capped base via `calcSsoParts`;
   reported wages = the exact SSO-eligible base the contribution was computed
   from (so the file is internally consistent).
4. **Placement:** a new `/admin/filings/sso` surface (forward-looking — PND1 and
   year-end filings will join `/admin/filings` later).
5. **Blocking validation:** if any included employee is missing a national ID, or
   the branch has no SSO account number, the export is **blocked** with a clear
   on-screen message (not exported with warnings).

## Non-goals (explicit YAGNI)

- สปส.1-10/1 consolidated multi-branch form.
- The legacy 135-character fixed-width media text file.
- สปส.6-01 (new-hire notification), กท.20 (employer registration), year-end
  กท.26ก / workmen's compensation.
- Direct SSO e-Service API submission (human uploads the file).
- ภ.ง.ด.1 (PND1) and any withholding-tax computation — separate spec.
- Title/prefix and Thai/English name split (use existing `firstName`/`lastName`;
  add title only if the verified SSO template requires it — see §Must-verify).

## Architecture

### Schema additions (additive, no migration risk to existing data)

- `Employee.nationalId String?` — 13-digit Thai national ID. Nullable (backfilled
  by admins). Validated on the employee edit form (format + mod-11 check digit).
- `Branch.ssoAccountNo String?` — the branch's SSO employer account number.
  Optionally `Branch.ssoBranchSeq String?` for the establishment sequence
  (ลำดับที่สาขา) if the verified template needs it. Edited on the branch edit form.

### National-ID validation — `src/lib/tax/national-id.ts` (pure)

- `isValidThaiNationalId(id: string): boolean` — 13 digits, mod-11 checksum
  (sum of first 12 digits × descending weights 13..2, check digit = (11 − sum%11) % 10).
- `formatNationalId(id: string): string` — display grouping (optional).
Unit-tested with known-valid and known-invalid IDs (including bad check digit).

### Data layer — `src/lib/filings/sso.ts` (server-only)

- `loadSsoFiling(month: string, branchId: string): Promise<SsoFiling>` where:

```ts
type SsoFilingRow = {
  employeeId: string;
  nationalId: string | null;   // null → flagged, blocks export
  name: string;                // firstName + lastName
  wages: number;               // the SSO-eligible base deductSso was computed on
  employeeContribution: number; // = deductSso
  employerContribution: number; // = calcSsoParts on the same base
};
type SsoFiling = {
  month: string;
  branch: { id: string; name: string; ssoAccountNo: string | null };
  rows: SsoFilingRow[];
  totals: { wages: number; employee: number; employer: number; grand: number; count: number };
  rate: number;                // ssoRate (for the summary %)
  problems: { missingNationalIds: number; missingBranchSso: boolean };
};
```

  Query: `payroll.findMany({ where: { month, employee: { branchId, hasSso: true, status: { not: 'Archived' } } }, include: { employee } })`,
  branch-scoped by the caller's permission. Map each to a row; compute
  `employerContribution` via `calcSsoParts`; accumulate totals; detect problems.

### Excel writer — `src/lib/filings/sso-xlsx.ts`

- `buildSsoXlsx(filing: SsoFiling): Promise<Buffer>` — emits the SSO e-Service
  upload layout (header row(s) with employer SSO account + period; Part-2 detail
  rows; summary totals), reusing `src/lib/export/xlsx.ts` primitives where they
  fit. **Must-verify (plan):** pin the exact column order/headers against a
  downloaded real SSO e-Service `.xlsx` upload template before finalizing — wrong
  columns → rejected upload. If the template requires a title/prefix column, add
  `Employee` title handling then.

### Export route — `src/app/(admin)/admin/filings/sso/export/route.ts`

- `nodejs` runtime, gated on `filing.export`. Reads `month` + `branchId` from
  query (validated; branch must be in the caller's permitted set). Calls
  `loadSsoFiling`; if `problems.missingNationalIds > 0` or `missingBranchSso`,
  returns a 4xx with a clear message (defense-in-depth; the UI blocks first).
  Else streams the `.xlsx` with RFC-5987 `Content-Disposition`
  (`สปส1-10_<branch>_<month>.xlsx`).

### UI — `src/app/(admin)/admin/filings/sso/page.tsx` (server component)

- Gated on `filing.read`. Month + branch pickers (URL-driven, like the audit /
  approvals filters). Renders `loadSsoFiling` results: a **validation banner**
  (missing national IDs listed with links to the employee edit page; missing
  branch SSO number with a link to the branch edit page), the per-employee
  **review table** (name, national ID, wages, employee contribution), and the
  **totals**. A **Download .xlsx** `<a href download>` to the export route,
  **disabled** while `problems` are non-empty.
- Sidebar: a new **"ยื่นประกันสังคม" / filings** entry (or under an existing
  section) gated on `filing.read`.

### Permissions

- New `filing.read` (view the filing page) and `filing.export` (download the
  file), added to `src/lib/auth/permissions.ts` and granted to Admin/Superadmin
  by default. Branch scoping via the existing `viaEmployeeBranchScope` /
  `permittedBranchesFromAssignments` so a branch-scoped admin only sees/export
  their branches.

## Error / empty states

- No payroll rows for the month+branch → empty state ("ยังไม่มีข้อมูลเงินเดือน…").
- Missing national IDs / branch SSO number → blocking banner (export disabled).
- Branch not in the caller's scope, or bad month format → `notFound()` / ignored.

## Testing

- **Unit:**
  - `isValidThaiNationalId` — valid IDs, wrong check digit, wrong length,
    non-digits.
  - Row mapper — name, wages = SSO base, `employeeContribution` = `deductSso`,
    `employerContribution` = `calcSsoParts` result; null national ID surfaces.
  - Totals accumulation; `problems` detection (missing IDs, missing branch SSO).
- **Integration:** `loadSsoFiling` against seeded payroll+employees for a
  month+branch — includes only `hasSso` employees of that home branch with a
  payroll row; excludes archived / non-SSO / other-branch; totals correct;
  branch scoping respected.
- **xlsx writer** verified via tsc/lint (no render harness), consistent with the
  audit/approvals features; a byte-level golden test is deferred until the real
  template columns are pinned.

## Files

**New**
- `src/lib/tax/national-id.ts` (+ `national-id.test.ts`).
- `src/lib/filings/sso.ts` — `loadSsoFiling` + types (+ integration test).
- `src/lib/filings/sso-xlsx.ts` — `buildSsoXlsx`.
- `src/app/(admin)/admin/filings/sso/page.tsx` — review UI.
- `src/app/(admin)/admin/filings/sso/export/route.ts` — download route.
- `src/app/(admin)/admin/filings/sso/sso-filters.tsx` — month+branch pickers (client).

**Modified**
- `prisma/schema.prisma` — add `Employee.nationalId`, `Branch.ssoAccountNo`
  (+ optional `ssoBranchSeq`); numbered migration hand-authored.
- Employee edit form + action — capture/validate `nationalId`.
- Branch edit form + action — capture `ssoAccountNo`.
- `src/lib/auth/permissions.ts` (+ roles) — `filing.read`, `filing.export`.
- `src/components/admin/sidebar.tsx` — filings nav entry.

## Phase 2 (deferred, no rework implied)

- ภ.ง.ด.1 (PND1) export on the same `/admin/filings` surface (needs withholding
  sourcing — separate spec).
- สปส.1-10/1 consolidated multi-branch filing.
- Legacy 135-char text output, if a client needs the media-upload path.
- Year-end / new-hire ancillary forms (50 ทวิ, สปส.6-01, กท.26ก).
