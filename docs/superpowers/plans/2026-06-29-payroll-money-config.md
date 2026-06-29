# Payroll Money Config Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a superadmin-gated `/admin/settings/payroll` page that edits every currently-unexposed `PayrollConfig` money field (SSO, OT, per-day deductions).

**Architecture:** Follows the existing settings-page pattern (server component → `requirePermission` → `<form action={...}>` → `'use server'` action → Zod validate → `prisma.payrollConfig.update` → `auditLog` → `revalidatePath` + redirect). Validation/conversion logic lives in a separate testable lib module because `'use server'` modules may only export async functions. A new `settings.payroll.manage` permission gates the page; superadmins get it via the `isSuperadmin` short-circuit, and it is intentionally NOT granted to the default Admin role.

**Tech Stack:** Next.js App Router (RSC + server actions), Prisma (`PayrollConfig` singleton, `Prisma.Decimal`), Zod, Vitest, Tailwind UI kit (`@/components/ui/*`).

## Global Constraints

- `PayrollConfig` is a seeded singleton — **UPDATE only, never create** (creation belongs to the seed).
- Money fields persist as `Prisma.Decimal` built from validated strings — **no float round-trip**.
- SSO rate is entered/displayed as a **percent** (e.g. `5`) and stored as a `Decimal(5,4)` fraction (`/100`).
- All user-facing copy is **Thai**, matching sibling settings pages.
- New permission key: `settings.payroll.manage`. Superadmin-only by default — do **not** add it to the Admin role in `src/lib/auth/roles.ts`.
- Tests run with `pnpm vitest run <path>`. Typecheck with `pnpm tsc --noEmit`.
- Field bounds: `ssoRatePercent` 0–100 (≤2 dp); `ssoSalaryCap`/`ssoAmountCap` 0–9,999,999.99 (>0); `otMultiplier` 1.00–9.99; `workingDaysPerMonth` int 1–31; `otThresholdMinutes` int 0–480; `absentDeductionPerDay`/`lateDeduction`/`earlyLeaveDeduction` 0–9,999,999.99 (≥0).

---

## File Structure

- Create `src/lib/payroll/money-config.ts` — Zod schema + `toPayrollConfigData()` converter (pure, testable).
- Create `src/lib/payroll/money-config.test.ts` — unit tests for schema + converter.
- Modify `src/lib/auth/permissions.ts` — add `settings.payroll.manage` to `PERMISSIONS` and the `settings` group.
- Modify `src/lib/auth/permissions.test.ts` — assert the new perm stays superadmin-only (not in Admin defaults).
- Create `src/app/(admin)/admin/settings/payroll/actions.ts` — `'use server'` `updatePayrollConfig`.
- Create `src/app/(admin)/admin/settings/payroll/page.tsx` — the settings page (server component).
- Create `src/app/(admin)/admin/settings/payroll/sso-card.tsx` — `'use client'` SSO card with live computed max + mismatch warning.
- Modify `src/app/(admin)/admin/settings/settings-nav.tsx` — add the payroll nav item + `requires`/`allowed` permission filtering.
- Modify `src/app/(admin)/admin/settings/layout.tsx` — resolve user, compute permission set, pass to nav.

---

## Task 1: Server-side foundation (permission + validated, gated mutation)

Delivers a fully validated, permission-gated `updatePayrollConfig` action plus its pure validation module and unit tests. Bundling the permission with its call-site keeps `perm-coverage.test.ts` green (the perm is "used"), and adding it to a group keeps `permissions.test.ts` green.

**Files:**
- Create: `src/lib/payroll/money-config.ts`
- Test: `src/lib/payroll/money-config.test.ts`
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/permissions.test.ts`
- Create: `src/app/(admin)/admin/settings/payroll/actions.ts`

**Interfaces:**
- Produces: `payrollMoneySchema` (Zod object), `type PayrollMoneyInput = z.infer<typeof payrollMoneySchema>`, and `toPayrollConfigData(input: PayrollMoneyInput): Prisma.PayrollConfigUpdateInput` from `@/lib/payroll/money-config`.
- Produces: `updatePayrollConfig(formData: FormData): Promise<void>` (server action) from the payroll route's `actions.ts`.
- Produces: permission key `'settings.payroll.manage'`.
- Consumes: `requirePermission` (`@/lib/auth/check-permission`), `auditLog` (`@/lib/audit/log`), `prisma` (`@/lib/db/prisma`).

- [ ] **Step 1: Write the failing test for the validation module**

Create `src/lib/payroll/money-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { payrollMoneySchema, toPayrollConfigData } from './money-config';

const VALID = {
  ssoRatePercent: '5',
  ssoSalaryCap: '17500',
  ssoAmountCap: '875',
  otMultiplier: '1.5',
  workingDaysPerMonth: '30',
  otThresholdMinutes: '30',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
};

describe('payrollMoneySchema', () => {
  it('accepts a valid payload', () => {
    expect(payrollMoneySchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a negative deduction', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, lateDeduction: '-1' });
    expect(r.success).toBe(false);
  });

  it('rejects an SSO rate above 100%', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoRatePercent: '150' });
    expect(r.success).toBe(false);
  });

  it('rejects more than two decimal places on money', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoSalaryCap: '17500.123' });
    expect(r.success).toBe(false);
  });

  it('rejects a non-integer workingDaysPerMonth', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, workingDaysPerMonth: '30.5' });
    expect(r.success).toBe(false);
  });
});

describe('toPayrollConfigData', () => {
  it('converts the SSO percent to a stored fraction', () => {
    const parsed = payrollMoneySchema.parse(VALID);
    const data = toPayrollConfigData(parsed);
    expect(data.ssoRate?.toString()).toBe('0.05');
    expect(data.ssoSalaryCap?.toString()).toBe('17500');
    expect(data.ssoAmountCap?.toString()).toBe('875');
    expect(data.otMultiplier?.toString()).toBe('1.5');
    expect(data.workingDaysPerMonth).toBe(30);
    expect(data.otThresholdMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/payroll/money-config.test.ts`
Expected: FAIL — cannot resolve `./money-config`.

- [ ] **Step 3: Implement the validation module**

Create `src/lib/payroll/money-config.ts`:

```ts
import { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Validation + conversion for the Payroll money-config form.
 *
 * Lives outside the `'use server'` action module because a server-action
 * file may only export async functions — this pure schema/converter must
 * be importable by both the action and its unit tests.
 *
 * Money is validated as a numeric string and persisted via `Prisma.Decimal`
 * built from that string, so values never round-trip through a JS float.
 */

const MONEY_MAX = 9_999_999.99;

/** A non-negative money string with up to 2 decimal places, within [min, max]. */
function money(label: string, min: number) {
  return z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), `${label}: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)`)
    .refine((s) => {
      const n = Number(s);
      return n >= min && n <= MONEY_MAX;
    }, `${label}: ต้องอยู่ระหว่าง ${min.toLocaleString()}–${MONEY_MAX.toLocaleString()}`);
}

export const payrollMoneySchema = z.object({
  // SSO. Rate entered as a percent (0–100, ≤2 dp); stored as a /100 fraction.
  ssoRatePercent: z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'อัตราประกันสังคม: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)')
    .refine((s) => {
      const n = Number(s);
      return n >= 0 && n <= 100;
    }, 'อัตราประกันสังคม: ต้องอยู่ระหว่าง 0–100%'),
  ssoSalaryCap: money('เพดานเงินเดือน (ประกันสังคม)', 0.01),
  ssoAmountCap: money('เพดานเงินสมทบ (ประกันสังคม)', 0.01),
  // OT.
  otMultiplier: z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'ตัวคูณ OT: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)')
    .refine((s) => {
      const n = Number(s);
      return n >= 1 && n <= 9.99;
    }, 'ตัวคูณ OT: ต้องอยู่ระหว่าง 1.00–9.99'),
  workingDaysPerMonth: z.coerce.number().int('วันทำงาน/เดือน: ต้องเป็นจำนวนเต็ม').min(1).max(31),
  otThresholdMinutes: z.coerce.number().int('เกณฑ์นาที OT: ต้องเป็นจำนวนเต็ม').min(0).max(480),
  // Deductions.
  absentDeductionPerDay: money('หักขาดงาน/วัน', 0),
  lateDeduction: money('หักมาสาย', 0),
  earlyLeaveDeduction: money('หักออกก่อนเวลา', 0),
});

export type PayrollMoneyInput = z.infer<typeof payrollMoneySchema>;

/** Map validated form input to a Prisma update payload (Decimal-safe). */
export function toPayrollConfigData(input: PayrollMoneyInput): Prisma.PayrollConfigUpdateInput {
  return {
    ssoRate: new Prisma.Decimal(input.ssoRatePercent).div(100),
    ssoSalaryCap: new Prisma.Decimal(input.ssoSalaryCap),
    ssoAmountCap: new Prisma.Decimal(input.ssoAmountCap),
    otMultiplier: new Prisma.Decimal(input.otMultiplier),
    workingDaysPerMonth: input.workingDaysPerMonth,
    otThresholdMinutes: input.otThresholdMinutes,
    absentDeductionPerDay: new Prisma.Decimal(input.absentDeductionPerDay),
    lateDeduction: new Prisma.Decimal(input.lateDeduction),
    earlyLeaveDeduction: new Prisma.Decimal(input.earlyLeaveDeduction),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/payroll/money-config.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the permission to the catalog**

In `src/lib/auth/permissions.ts`, add to the `PERMISSIONS` object under the "Org settings" block (after `'settings.attendance.manage'`):

```ts
  'settings.payroll.manage': 'จัดการการตั้งค่าเงินเดือน (ประกันสังคม / OT / หักเงิน)',
```

And in `PERMISSION_GROUPS`, append the key to the `settings` group's `permissions` array (after `'settings.attendance.manage'`):

```ts
      'settings.attendance.manage',
      'settings.payroll.manage',
```

- [ ] **Step 6: Add the superadmin-only guard test**

In `src/lib/auth/permissions.test.ts`, inside the `describe('SYSTEM_ROLES', ...)` block, add:

```ts
  it('keeps settings.payroll.manage superadmin-only (absent from Admin defaults)', () => {
    expect(SYSTEM_ROLES.admin.permissions).not.toContain('settings.payroll.manage');
    expect(SYSTEM_ROLES.staff.permissions).not.toContain('settings.payroll.manage');
  });
```

- [ ] **Step 7: Create the server action**

Create `src/app/(admin)/admin/settings/payroll/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { payrollMoneySchema, toPayrollConfigData } from '@/lib/payroll/money-config';

export async function updatePayrollConfig(formData: FormData) {
  const { user } = await requirePermission('settings.payroll.manage');

  const parsed = payrollMoneySchema.safeParse({
    ssoRatePercent: formData.get('ssoRatePercent'),
    ssoSalaryCap: formData.get('ssoSalaryCap'),
    ssoAmountCap: formData.get('ssoAmountCap'),
    otMultiplier: formData.get('otMultiplier'),
    workingDaysPerMonth: formData.get('workingDaysPerMonth'),
    otThresholdMinutes: formData.get('otThresholdMinutes'),
    absentDeductionPerDay: formData.get('absentDeductionPerDay'),
    lateDeduction: formData.get('lateDeduction'),
    earlyLeaveDeduction: formData.get('earlyLeaveDeduction'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/payroll?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  // PayrollConfig is a seeded singleton — UPDATE only, never create.
  const before = await prisma.payrollConfig.findFirst();
  if (!before) {
    redirect(
      `/admin/settings/payroll?error=${encodeURIComponent('ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน')}`,
    );
  }

  await prisma.payrollConfig.update({
    where: { id: before.id },
    data: toPayrollConfigData(parsed.data),
  });

  auditLog({
    actorId: user.id,
    action: 'payrollConfig.update',
    entityType: 'PayrollConfig',
    entityId: before.id,
    before: {
      ssoRate: before.ssoRate.toString(),
      ssoSalaryCap: before.ssoSalaryCap.toString(),
      ssoAmountCap: before.ssoAmountCap.toString(),
      otMultiplier: before.otMultiplier.toString(),
      workingDaysPerMonth: before.workingDaysPerMonth,
      otThresholdMinutes: before.otThresholdMinutes,
      absentDeductionPerDay: before.absentDeductionPerDay.toString(),
      lateDeduction: before.lateDeduction.toString(),
      earlyLeaveDeduction: before.earlyLeaveDeduction.toString(),
    },
    after: parsed.data,
    metadata: { source: 'admin-ui', section: 'payroll-money' },
  });

  revalidatePath('/admin/settings/payroll');
  redirect('/admin/settings/payroll?ok=1');
}
```

- [ ] **Step 8: Run the guard + unit tests and typecheck**

Run: `pnpm vitest run src/lib/payroll/money-config.test.ts src/lib/auth/permissions.test.ts src/lib/auth/perm-coverage.test.ts`
Expected: PASS — in particular `perm-coverage` "no orphaned permissions" passes because `actions.ts` calls `requirePermission('settings.payroll.manage')`, and `permissions` "cover every catalog permission" passes because it's in the `settings` group.

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/payroll/money-config.ts src/lib/payroll/money-config.test.ts src/lib/auth/permissions.ts src/lib/auth/permissions.test.ts "src/app/(admin)/admin/settings/payroll/actions.ts"
git commit -m "feat(payroll): settings.payroll.manage permission + validated config action"
```

---

## Task 2: Settings page UI + SSO live-calc card

Renders the page with three cards and wires the form to `updatePayrollConfig`. The SSO card is a client component that shows the computed max contribution live and warns when `ssoAmountCap` ≠ `ssoRate × ssoSalaryCap` (the exact mistake that prompted this feature).

**Files:**
- Create: `src/app/(admin)/admin/settings/payroll/sso-card.tsx`
- Create: `src/app/(admin)/admin/settings/payroll/page.tsx`

**Interfaces:**
- Consumes: `updatePayrollConfig` (Task 1), `requirePermission`, `prisma`, UI kit (`@/components/ui/{button,card,form-field,input,page-header}`).
- Produces: `SsoCard` component; default export `PayrollConfigPage`.

- [ ] **Step 1: Create the SSO client card**

Create `src/app/(admin)/admin/settings/payroll/sso-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * SSO card with a live "rate × ceiling = max" line. Inputs are uncontrolled
 * form fields (they submit with the parent server-component form) but mirrored
 * into local state so we can show the computed contribution and warn when the
 * amount cap doesn't match — leaving the amount cap behind silently
 * neutralizes a salary-ceiling change (calc applies BOTH caps).
 */
export function SsoCard({
  defaultRatePercent,
  defaultSalaryCap,
  defaultAmountCap,
}: {
  defaultRatePercent: string;
  defaultSalaryCap: string;
  defaultAmountCap: string;
}) {
  const [ratePercent, setRatePercent] = useState(defaultRatePercent);
  const [salaryCap, setSalaryCap] = useState(defaultSalaryCap);
  const [amountCap, setAmountCap] = useState(defaultAmountCap);

  const r = Number(ratePercent);
  const s = Number(salaryCap);
  const a = Number(amountCap);
  const product = Number.isFinite(r) && Number.isFinite(s) ? (r / 100) * s : NaN;
  const mismatch =
    Number.isFinite(product) && Number.isFinite(a) && Math.round(product) !== Math.round(a);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ประกันสังคม</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="อัตรา (%)" htmlFor="ssoRatePercent">
            <Input
              id="ssoRatePercent"
              name="ssoRatePercent"
              inputMode="decimal"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เพดานเงินเดือน (บาท)" htmlFor="ssoSalaryCap">
            <Input
              id="ssoSalaryCap"
              name="ssoSalaryCap"
              inputMode="decimal"
              value={salaryCap}
              onChange={(e) => setSalaryCap(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เพดานเงินสมทบ (บาท)" htmlFor="ssoAmountCap">
            <Input
              id="ssoAmountCap"
              name="ssoAmountCap"
              inputMode="decimal"
              value={amountCap}
              onChange={(e) => setAmountCap(e.target.value)}
              required
            />
          </FormField>
        </div>
        {Number.isFinite(product) && (
          <p className="text-sm text-ink-3">
            เงินสมทบสูงสุด = {ratePercent}% × {s.toLocaleString('en-US')} ={' '}
            <strong>฿{product.toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong>
          </p>
        )}
        {mismatch && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-deep">
            เพดานเงินสมทบ (฿{a.toLocaleString('en-US')}) ไม่เท่ากับ อัตรา × เพดานเงินเดือน (฿
            {product.toLocaleString('en-US', { maximumFractionDigits: 2 })}) — ตรวจสอบอีกครั้งหากไม่ได้ตั้งใจ
          </p>
        )}
      </CardBody>
    </Card>
  );
}
```

Note: if the `warning-soft` / `warning-deep` tokens don't exist in this codebase, substitute the existing alert tokens used elsewhere (`bg-danger-soft` / `text-danger-deep` are confirmed present in `leave-config/page.tsx`). Verify with: `grep -rn "warning-soft\|warning-deep" src` before relying on them.

- [ ] **Step 2: Create the page**

Create `src/app/(admin)/admin/settings/payroll/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { updatePayrollConfig } from './actions';
import { SsoCard } from './sso-card';

export default async function PayrollConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.payroll.manage');
  const cfg = await prisma.payrollConfig.findFirst();
  const sp = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="เงินเดือน"
        subtitle="ประกันสังคม / ค่าล่วงเวลา / รายการหักเงิน — มีผลกับการคำนวณเงินเดือนรอบถัดไป (สลิปเก่าไม่เปลี่ยน)"
      />

      {sp.error && (
        <div role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          {sp.error}
        </div>
      )}
      {sp.ok && (
        <div className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep">
          บันทึกแล้ว
        </div>
      )}

      {!cfg ? (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน
        </div>
      ) : (
        <form action={updatePayrollConfig} className="max-w-2xl space-y-6">
          <SsoCard
            defaultRatePercent={cfg.ssoRate.times(100).toString()}
            defaultSalaryCap={cfg.ssoSalaryCap.toString()}
            defaultAmountCap={cfg.ssoAmountCap.toString()}
          />

          <Card>
            <CardHeader>
              <CardTitle>ค่าล่วงเวลา (OT)</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="ตัวคูณ OT" htmlFor="otMultiplier">
                <Input id="otMultiplier" name="otMultiplier" inputMode="decimal" defaultValue={cfg.otMultiplier.toString()} required />
              </FormField>
              <FormField label="วันทำงาน/เดือน" htmlFor="workingDaysPerMonth">
                <Input id="workingDaysPerMonth" name="workingDaysPerMonth" type="number" min={1} max={31} defaultValue={cfg.workingDaysPerMonth} required />
              </FormField>
              <FormField label="เกณฑ์นาทีเข้าข่าย OT" htmlFor="otThresholdMinutes">
                <Input id="otThresholdMinutes" name="otThresholdMinutes" type="number" min={0} max={480} defaultValue={cfg.otThresholdMinutes} required />
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>รายการหักเงิน</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="หักขาดงาน/วัน (บาท)" htmlFor="absentDeductionPerDay">
                  <Input id="absentDeductionPerDay" name="absentDeductionPerDay" inputMode="decimal" defaultValue={cfg.absentDeductionPerDay.toString()} required />
                </FormField>
                <FormField label="หักมาสาย (บาท)" htmlFor="lateDeduction">
                  <Input id="lateDeduction" name="lateDeduction" inputMode="decimal" defaultValue={cfg.lateDeduction.toString()} required />
                </FormField>
                <FormField label="หักออกก่อนเวลา (บาท)" htmlFor="earlyLeaveDeduction">
                  <Input id="earlyLeaveDeduction" name="earlyLeaveDeduction" inputMode="decimal" defaultValue={cfg.earlyLeaveDeduction.toString()} required />
                </FormField>
              </div>
              <p className="text-sm text-ink-4">
                นโยบายมาสาย (3 ครั้ง / สายรุนแรง) ตั้งค่าที่หน้า “การมาสาย & รอบจ่าย”
              </p>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">บันทึก</Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors. (If `cfg.ssoRate.times` is rejected by the Decimal type, use `cfg.ssoRate.mul(100).toString()` — `times`/`mul` are aliases in decimal.js.)

- [ ] **Step 4: Manual verification**

Start the app (`pnpm dev`), sign in as a **Superadmin**, visit `/admin/settings/payroll`:
- Confirm the three cards render with the current values (SSO rate shows `5`, ceiling `17500`, amount cap `875`).
- Edit the SSO ceiling to `20000` without touching the amount cap → the warning line appears (`875 ≠ 1,000`).
- Set amount cap to `1000` → warning clears, computed line reads `฿1,000`.
- Submit → redirected back with the green "บันทึกแล้ว" banner.
- Verify persistence: `select "ssoSalaryCap","ssoAmountCap" from "PayrollConfig";` reflects the new values; then restore to `17500`/`875` if this was a real DB.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings/payroll/page.tsx" "src/app/(admin)/admin/settings/payroll/sso-card.tsx"
git commit -m "feat(payroll): settings page with SSO live-calc + OT/deduction cards"
```

---

## Task 3: Permission-aware settings nav

Adds the payroll tab and hides it from users lacking `settings.payroll.manage` (i.e. everyone but superadmin by default), so no one sees a tab that 404s.

**Files:**
- Modify: `src/app/(admin)/admin/settings/settings-nav.tsx`
- Modify: `src/app/(admin)/admin/settings/layout.tsx`

**Interfaces:**
- Consumes: `getPermissionsFor` (`@/lib/auth/check-permission`), `requireRole` (`@/lib/auth/require-role`), `type Permission` (`@/lib/auth/permissions`).
- Produces: `SettingsNav({ allowed }: { allowed: string[] })`.

- [ ] **Step 1: Make the nav permission-aware**

In `src/app/(admin)/admin/settings/settings-nav.tsx`:

1. Add the import: `import type { Permission } from '@/lib/auth/permissions';` and add `Banknote` to the `lucide-react` import list.
2. Extend the `Item` type with an optional gate:

```ts
type Item = { href: string; label: string; desc: string; Icon: LucideIcon; requires?: Permission };
```

3. Add the payroll item to `ITEMS` immediately after the `attendance` item:

```ts
  {
    href: '/admin/settings/payroll',
    label: 'เงินเดือน',
    desc: 'ประกันสังคม / OT / หักเงิน',
    Icon: Banknote,
    requires: 'settings.payroll.manage',
  },
```

4. Change the component signature and filter the items:

```ts
export function SettingsNav({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.requires || allowed.includes(i.requires));
```

Then map over `items` instead of `ITEMS` in the JSX.

- [ ] **Step 2: Feed permissions from the layout**

Replace `src/app/(admin)/admin/settings/layout.tsx` with:

```tsx
import { getPermissionsFor } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { SettingsNav } from './settings-nav';

/**
 * Settings layout — sticky sub-nav beside the entity pages. Resolves the
 * caller's permission set so the nav can hide tabs they can't open (e.g. the
 * superadmin-only payroll config).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(['Admin', 'Superadmin']);
  const allowed = [...(await getPermissionsFor(user))];

  return (
    <div className="lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-gray-100 px-4 py-4 sm:px-6 lg:sticky lg:top-4 lg:self-start lg:border-b-0 lg:px-4 lg:py-6">
        <SettingsNav allowed={allowed} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

- As **Superadmin**: the “เงินเดือน” tab appears in the settings sub-nav and opens the page.
- As a plain **Admin** (without the perm): the tab is absent, and navigating directly to `/admin/settings/payroll` returns 404 (the page's `requirePermission` gate).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings/settings-nav.tsx" "src/app/(admin)/admin/settings/layout.tsx"
git commit -m "feat(settings): permission-aware nav; show payroll tab to superadmin only"
```

---

## Self-Review

**Spec coverage:**
- §A permission & roles → Task 1 (steps 5–6).
- §B route & files → Task 1 (action), Task 2 (page).
- §B1 permission-aware nav → Task 3.
- §C fields & validation → Task 1 (`money-config.ts`) + Task 2 (inputs).
- §D SSO safeguard → Task 2 (`sso-card.tsx`).
- §E audit & cache → Task 1 (step 7).
- §F testing → Task 1 (unit + guard tests); UI verified manually in Tasks 2–3 (no RSC/server-action test harness exists in this repo — consistent with sibling settings pages, which are not unit-tested).
- §G out of scope → respected (no per-branch config, no rate history, attendance-page fields untouched).

**Placeholder scan:** none — every step has concrete code/commands. Two conditional fallbacks are explicit and checkable (`warning-*` tokens; `times` vs `mul`).

**Type consistency:** `payrollMoneySchema` / `PayrollMoneyInput` / `toPayrollConfigData` names match across `money-config.ts`, its test, and `actions.ts`. `updatePayrollConfig` matches between `actions.ts` and `page.tsx`. `SettingsNav({ allowed })` matches between `settings-nav.tsx` and `layout.tsx`. Permission key `'settings.payroll.manage'` is identical across catalog, action, page, nav.
