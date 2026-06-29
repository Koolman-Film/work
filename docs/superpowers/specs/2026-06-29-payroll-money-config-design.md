# Superadmin-configurable Payroll money settings — Design

**Date:** 2026-06-29
**Status:** Approved (design); pending implementation plan
**Branch:** claude/focused-proskuriakova-580728

## Problem

The `PayrollConfig` singleton holds the "money math" fields used by payroll
calculation — Social Security (SSO) rate and caps, the OT multiplier, and the
per-day deduction amounts. These are **not editable in any admin UI** today.

The trigger: an HR user asked to raise the SSO salary ceiling from ₿15,000 to
₿17,500 per Thai law. That required a direct production DB edit (and a
non-obvious second edit to `ssoAmountCap`, because the calc applies both caps —
`min(min(base, salaryCap) × rate, amountCap)` in `src/lib/payroll/calc.ts`).
Such legally-mandated changes should be self-serviceable, not require an
engineer running SQL.

## Goal

A new **Payroll money config** settings page, gated to **superadmin**, that
edits every currently-unexposed `PayrollConfig` money field.

## Non-goals (YAGNI)

- No per-branch payroll config (the singleton stays global).
- No effective-dated history / scheduled rate changes.
- No migration of the fields already exposed on the attendance settings page
  (`workStartTime`, `lateGraceMinutes`, `cutoffDay`, late-three-strike and
  severe-late policy).
- No retroactive recalculation — past `Payroll` rows snapshot their config at
  run time (`src/lib/payroll/run.ts`), so existing payslips are unaffected.

## Context (existing patterns this follows)

- **`PayrollConfig` is a seeded singleton, UPDATE-only.** The attendance
  settings action (`src/app/(admin)/admin/settings/attendance/actions.ts`)
  already updates a subset of its fields and explicitly never creates it.
- **Settings page pattern** (cleanest reference: `leave-config`):
  server component → `requirePermission('settings.X.manage')` → form with
  `action={updateX}` → server action does Zod validate → prisma update →
  `auditLog` → `revalidatePath` + redirect with `?ok=1` / `?error=...`.
- **Permission model** (`src/lib/auth/check-permission.ts`): every settings
  page gates on a `settings.X.manage` permission. A role with
  `isSuperadmin=true` short-circuits `canDo()` to grant ALL permissions, so a
  new permission that is simply never added to a non-superadmin role is
  effectively superadmin-only — while still being grantable to a custom role
  later via the Roles UI.

## Decisions

1. **Scope:** all currently-unexposed `PayrollConfig` money fields (not SSO
   only).
2. **Gating:** new `settings.payroll.manage` permission — superadmin-only by
   default, assignable to a custom role later. Not granted to the default Admin
   role.

## Design

### A. Permission & roles

- Add to the catalog in `src/lib/auth/permissions.ts`:
  `'settings.payroll.manage': 'จัดการการตั้งค่าเงินเดือน (ประกันสังคม / OT / หักเงิน)'`
- Add the key to the `settings` group in `PERMISSION_GROUPS` (same file) so it
  renders in the role permission-picker.
- **Do not** add it to the Admin role's permission array in
  `src/lib/auth/roles.ts`. Superadmin gains it via the `isSuperadmin` flag.
- **No DB migration needed:** we change no existing role's stored permissions.
  Superadmins gain the permission through the flag, not the stored array.

### B. Route & files

- `src/app/(admin)/admin/settings/payroll/page.tsx` — server component.
  `await requirePermission('settings.payroll.manage')`. Loads the
  `PayrollConfig` singleton (`prisma.payrollConfig.findFirst()`); if absent,
  render the same "run seed first" error the attendance page uses. Renders the
  three cards (below) inside a `<form action={updatePayrollConfig}>`. Shows
  `error` / `ok` banners from `searchParams` (same markup as `leave-config`).
- `src/app/(admin)/admin/settings/payroll/actions.ts` — `'use server'`.
  `requirePermission('settings.payroll.manage')` → Zod parse → UPDATE-only
  `prisma.payrollConfig.update` → `auditLog` → `revalidatePath` + redirect.
- Nav: add `{ href: '/admin/settings/payroll', label: 'เงินเดือน',
  desc: 'ประกันสังคม / OT / หักเงิน', Icon: Banknote, requires:
  'settings.payroll.manage' }` to `src/app/(admin)/admin/settings/settings-nav.tsx`.

### B1. Permission-aware nav (small, scoped improvement)

`settings-nav.tsx` is currently a static client component with no permission
filtering, so every admin sees every tab and unauthorized pages 404 on click.
To avoid showing a superadmin-only tab that 404s for regular admins:

- The settings `layout.tsx` (server component) resolves the current user and
  calls `getPermissionsFor(user)`, passing the resulting permission set (as a
  `string[]`) to `SettingsNav`.
- `SettingsNav` items gain an optional `requires?: Permission`. An item renders
  only when it has no `requires` OR the permission set includes it.
- Only the new payroll item sets `requires`; all existing items keep their
  current always-visible behavior (no `requires`), so no behavior change for
  them.

### C. Fields & validation

Three cards covering every unexposed money field:

1. **ประกันสังคม (SSO)**
   - `ssoRate` — entered as a percent (UI shows `5` for 5%), range `0–100`,
     converted to a `Decimal(5,4)` fraction (`/100`) on save.
   - `ssoSalaryCap` — `Decimal(12,2)`, `> 0`.
   - `ssoAmountCap` — `Decimal(12,2)`, `> 0`.
2. **ค่าล่วงเวลา (OT)**
   - `otMultiplier` — `Decimal(3,2)`, `1.00–9.99`.
   - `workingDaysPerMonth` — int `1–31`.
   - `otThresholdMinutes` — int `0–480`.
3. **รายการหักเงิน (Deductions)**
   - `absentDeductionPerDay` — `Decimal(12,2)`, `>= 0`.
   - `lateDeduction` — `Decimal(12,2)`, `>= 0`.
   - `earlyLeaveDeduction` — `Decimal(12,2)`, `>= 0`.

Money fields are validated as numeric strings and persisted via
`Prisma.Decimal` constructed from the validated string — no float round-trip,
consistent with how `calc.ts` handles money. Integer fields use
`z.coerce.number().int()` with bounds (matching the attendance action style).
A one-line note on the Deductions card cross-references that the late
three-strike / severe-late *policy* lives on the attendance settings page,
while `lateDeduction` (flat per-late charge) lives here.

### D. SSO safeguard

The SSO card is a small **client component** that shows a live computed line —
e.g. `5% × 17,500 = ฿875` — and an inline **soft warning** when the entered
`ssoAmountCap` differs from `ssoRate × ssoSalaryCap`. It does not block submit
(the law can set a flat max that differs from the product), but it makes the
neutralized-cap mistake impossible to miss. The other two cards are plain
server-rendered inputs.

### E. Audit & cache

```
auditLog({
  actorId: user.id,
  action: 'payrollConfig.update',
  entityType: 'PayrollConfig',
  entityId: before.id,
  before: <changed fields, prior values>,
  after: parsed.data,
  metadata: { source: 'admin-ui', section: 'payroll-money' },
})
```

Then `revalidatePath('/admin/settings/payroll')` and redirect to
`/admin/settings/payroll?ok=1` (or `?error=<message>` on validation failure).

## Testing

- **Zod schema unit tests:** valid input passes; percent→fraction conversion is
  correct; decimal-string handling avoids float drift; negatives and
  out-of-range values are rejected with Thai messages.
- **Permission tests:** a non-superadmin without `settings.payroll.manage` is
  rejected (`notFound`); a custom role granted the permission passes; a
  superadmin passes via the flag.
- **No changes to `calc.ts`** — existing `calcSso` / payroll calc tests remain
  green and are the regression guard for the math.

## Effects & migration

- Takes effect on the **next payroll run** going forward; past payslips keep
  their snapshotted values.
- The production `PayrollConfig` SSO values were already corrected to
  `ssoSalaryCap=17500`, `ssoAmountCap=875` (and `prisma/seed.ts` updated to
  match) prior to this work — this feature makes future such changes
  self-serviceable rather than requiring direct SQL.
