# Withholding Tax — M2a (tax can be entered) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make withholding tax reachable — an admin can turn the module on and record a month's tax figure per employee — without changing anything for anyone until the switch is flipped.

**Architecture:** M1 built the engine: `Tax`-kind adjustments sum into `Payroll.deductTax`, gated by `PayrollConfig.whtEnabled`, and reduce `netPay` only when the employee bears the tax. M1 is unreachable because no UI can set the switch or create a `Tax` adjustment. M2a adds exactly those two things plus a guard against the failure mode routing tax through `PayrollAdjustment` introduces.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Prisma + Postgres, zod, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-07-withholding-tax-design.md` (§4.4 is this plan's Task 4)
**Predecessor:** `docs/superpowers/plans/2026-09-07-withholding-tax-m1.md` — complete, merged in `feat/accounting-exports`.

## Global Constraints

- Branch: `feat/accounting-exports`, currently at `9204dd1`. `main` is `b82bf08`.
- **No schema change in this plan.** Every column M2a needs shipped in migration `0051`. If you reach for a migration, stop — the design decision was to keep the bearer a plain boolean with a bulk action (M2b), not a nullable inherit-from-config tri-state.
- **`whtEnabled` ships `false` and stays `false`.** The owner's decision: build M2 fully, turn it on at a moment of their choosing. Do not seed, migrate, or default it to true.
- **Never `git add -A`** — the repo holds un-gitignored local files. Stage explicit paths.
- Gate before every commit: `npx vitest run`, `pnpm typecheck`, `npx biome check src`.
- **After any branch switch that crosses a schema change, run `npx dotenv -e .env.local -- npx prisma generate` before trusting a typecheck.** `node_modules` is not branch-scoped; this produced four phantom errors on `main` during M1.
- Local Supabase: ports 54421/54422, config `.env.local`.

---

### Task 1: The `whtEnabled` switch in payroll settings

**Files:**
- Modify: `src/lib/payroll/money-config.ts` (`payrollMoneySchema`, `toPayrollConfigData`)
- Modify: `src/app/(admin)/admin/settings/payroll/actions.ts:12-27` (the `safeParse` input)
- Modify: `src/app/(admin)/admin/settings/payroll/page.tsx` (add the control)
- Test: `src/lib/payroll/money-config.test.ts`

**Interfaces:**
- Consumes: `PayrollConfig.whtEnabled` (migration 0051).
- Produces: `payrollMoneySchema` accepts `whtEnabled`; `toPayrollConfigData` returns it as a boolean.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/payroll/money-config.test.ts`. The file already defines `const VALID` at line 4 — spread it.

```ts
describe('payrollMoneySchema — whtEnabled', () => {
  it("reads an unchecked checkbox (absent from FormData) as false", () => {
    // An HTML checkbox submits nothing when unchecked. Parsing that as
    // anything but false would turn withholding ON by omission.
    const parsed = payrollMoneySchema.safeParse({ ...VALID, whtEnabled: null });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.whtEnabled).toBe(false);
  });

  it("reads a checked checkbox ('on') as true", () => {
    const parsed = payrollMoneySchema.safeParse({ ...VALID, whtEnabled: 'on' });
    expect(parsed.success && parsed.data.whtEnabled).toBe(true);
  });

  it('defaults to false when the field is missing entirely', () => {
    const parsed = payrollMoneySchema.safeParse({ ...VALID });
    expect(parsed.success && parsed.data.whtEnabled).toBe(false);
  });

  it('carries the boolean through to the Prisma update data', () => {
    const parsed = payrollMoneySchema.parse({ ...VALID, whtEnabled: 'on' });
    expect(toPayrollConfigData(parsed).whtEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/lib/payroll/money-config.test.ts`
Expected: FAIL — `whtEnabled` is not in the schema, so `parsed.data.whtEnabled` is `undefined`, not `false`.

- [ ] **Step 3: Add the field to the schema**

In `src/lib/payroll/money-config.ts`, inside `payrollMoneySchema` (after `absenceDerivedFrom`):

```ts
  /**
   * Master switch for withholding tax.
   *
   * An HTML checkbox submits the string 'on' when checked and NOTHING when
   * unchecked, so `formData.get()` yields `'on' | null`. Modelled explicitly
   * rather than with `z.coerce.boolean()`: coercion would also read the string
   * 'false' as true, and the direction of a mistake here matters — reading a
   * missing field as ON would start withholding tax from every payslip
   * without anyone choosing it.
   */
  whtEnabled: z
    .union([z.literal('on'), z.null(), z.undefined()])
    .transform((v) => v === 'on'),
```

In `toPayrollConfigData`, add to the returned object:

```ts
    whtEnabled: input.whtEnabled,
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/lib/payroll/money-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Feed the field from the form action**

In `src/app/(admin)/admin/settings/payroll/actions.ts`, add to the `safeParse` object (after `absenceDerivedFrom`):

```ts
    whtEnabled: formData.get('whtEnabled'),
```

- [ ] **Step 6: Add the control to the settings page**

In `src/app/(admin)/admin/settings/payroll/page.tsx`, add a card near the SSO card. Match the surrounding markup; the essential part is the input's `name` and `defaultChecked`:

```tsx
<label className="flex items-start gap-3 text-sm">
  <input
    type="checkbox"
    name="whtEnabled"
    defaultChecked={cfg.whtEnabled}
    className="mt-0.5 h-4 w-4 rounded border-line-strong text-primary-600 focus:ring-primary-500"
  />
  <span>
    <span className="font-medium text-ink-1">หักภาษี ณ ที่จ่าย</span>
    <span className="mt-0.5 block text-ink-3">
      เมื่อเปิด จะบันทึกภาษีหัก ณ ที่จ่ายในเงินเดือนได้ และแสดงในสลิป —
      ปิดอยู่จะไม่มีผลกับการคำนวณใด ๆ
    </span>
  </span>
</label>
```

- [ ] **Step 7: Verify in the browser**

Run `preview_start` with the `dev` config, sign in as `admin@koolman.local`, open `/admin/settings/payroll`, tick the box, save, reload. Expected: the box stays ticked. Then untick, save, reload — stays unticked. Confirm with:

```bash
npx dotenv -e .env.local -- npx prisma studio
```

or a direct read; the point is that the value round-trips to the database rather than only appearing to.

- [ ] **Step 8: Turn it back off**

Leave the local config with `whtEnabled: false`. Later tasks test the OFF path, and a stray ON would make them pass for the wrong reason.

- [ ] **Step 9: Full gate and commit**

```bash
npx vitest run && pnpm typecheck && npx biome check src
git add src/lib/payroll/money-config.ts src/lib/payroll/money-config.test.ts \
  'src/app/(admin)/admin/settings/payroll/actions.ts' \
  'src/app/(admin)/admin/settings/payroll/page.tsx'
git commit -m "feat(payroll): a switch for withholding tax in payroll settings

The master switch M1 already honours, now reachable. Ships off, and
nothing about payroll changes until it is turned on.

Modelled as 'on' | null rather than z.coerce.boolean(): an unchecked
checkbox submits nothing, and coercion would also read the string
'false' as true. The direction of a mistake matters here — reading a
missing field as ON would start withholding tax from every payslip
without anyone choosing it."
```

---

### Task 2: `Tax` accepted by the adjustment schema, one-time only

**Files:**
- Modify: `src/app/(admin)/admin/payroll/adjustments/adjustment-schema.ts`
- Test: `src/app/(admin)/admin/payroll/adjustments/adjustment-schema.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces: the submit schema accepts `kind: 'Tax'` **only** with `frequency: 'once'`.

- [ ] **Step 1: Write the failing tests**

Append to the EXISTING `src/app/(admin)/admin/payroll/adjustments/adjustment-schema.test.ts`. That file already defines an `fd()` FormData helper and a `BASE` object — reuse both.

**The schema is not exported.** `const Schema` is private; the public API is
`readForm(formData: FormData)`, which returns
`{ success: true; data } | { success: false; error: string }` — a message
string, not a zod error, so assert on `error` text rather than an issue path.

```ts
describe('adjustment readForm — Tax kind', () => {
  const TAX = { ...BASE, kind: 'Tax', reason: 'ภาษีหัก ณ ที่จ่าย' };

  it('accepts a one-time Tax adjustment', () => {
    const r = readForm(fd({ ...TAX, frequency: 'once' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.endMonth).toBe('2026-06');
  });

  it('rejects an open-ended monthly Tax adjustment', () => {
    // A recurring tax figure would repeat a stale number into every future
    // month and silently misreport ภ.ง.ด.1 — the one place a convenience
    // feature becomes a filing error.
    const r = readForm(fd({ ...TAX, frequency: 'monthly' }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('ครั้งเดียว');
  });

  it('rejects a date-range Tax adjustment', () => {
    const r = readForm(fd({ ...TAX, frequency: 'range', endMonth: '2026-12' }));
    expect(r.success).toBe(false);
  });

  it('still allows monthly for Income and Deduction', () => {
    // The restriction is about tax, not about frequencies in general.
    for (const kind of ['Income', 'Deduction']) {
      const r = readForm(fd({ ...BASE, kind, frequency: 'monthly' }));
      expect(r.success, kind).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/\(admin\)/admin/payroll/adjustments/adjustment-schema.test.ts`
Expected: FAIL on the first test — `kind: 'Tax'` is not in the enum, so even the valid case is rejected.

- [ ] **Step 3: Widen the enum and add the frequency rule**

In `adjustment-schema.ts`, change the enum:

```ts
    kind: z.enum(['Income', 'Deduction', 'Tax'], { message: 'กรุณาเลือกประเภท' }),
```

Then add to the existing `.superRefine((data, ctx) => { ... })`, after the `range` block:

```ts
    // Tax is a fresh figure every month, never a standing instruction. An
    // open-ended or ranged Tax adjustment would repeat one month's number
    // into every later month and silently misreport ภ.ง.ด.1 — a convenience
    // that turns into a filing error nobody would notice until the year end.
    if (data.kind === 'Tax' && data.frequency !== 'once') {
      ctx.addIssue({
        code: 'custom',
        path: ['frequency'],
        message: 'ภาษีหัก ณ ที่จ่ายต้องบันทึกเป็นรายเดือนครั้งเดียว ไม่ใช่รายการต่อเนื่อง',
      });
    }
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/app/\(admin\)/admin/payroll/adjustments/adjustment-schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the rule can fail**

Temporarily delete the `data.kind === 'Tax'` block and re-run. Expected: the two rejection tests fail. Restore it. A validation that has never been seen to reject is not known to work.

- [ ] **Step 6: Full gate and commit**

```bash
npx vitest run && pnpm typecheck && npx biome check src
git add 'src/app/(admin)/admin/payroll/adjustments/adjustment-schema.ts' \
  'src/app/(admin)/admin/payroll/adjustments/adjustment-schema.test.ts'
git commit -m "feat(payroll): accept Tax adjustments, one month at a time

The submit schema now admits kind: 'Tax' — M1 widened only the read
types, so nothing could create one.

Tax is restricted to frequency 'once'. It is a fresh figure every month,
never a standing instruction: an open-ended Tax adjustment would repeat
one month's number into every later month and silently misreport
ภ.ง.ด.1. Income and Deduction keep all three frequencies.

Rule proved by deleting it and watching both rejection tests fail."
```

---

### Task 3: The `Tax` option in the form, shown only when the switch is on

**Files:**
- Modify: `src/app/(admin)/admin/payroll/adjustments/adjustment-form.tsx`
- Modify: whichever pages render `<AdjustmentForm>` — find them with
  `grep -rln "AdjustmentForm" src --include='*.tsx'` — to pass the new prop.

**Interfaces:**
- Consumes: `PayrollConfig.whtEnabled`, read server-side by the pages.
- Produces: `AdjustmentForm` gains a required `whtEnabled: boolean` prop.

- [ ] **Step 1: Add the prop**

In `adjustment-form.tsx`, add to the component's props type:

```ts
  /**
   * `PayrollConfig.whtEnabled`. Required, not defaulted: a page that forgot
   * to pass it would silently hide the Tax option, and "the option is not
   * there" is indistinguishable from "the switch is off" to whoever is
   * standing in front of the screen.
   */
  whtEnabled: boolean;
```

- [ ] **Step 2: Add the third radio**

In the `ประเภท` FormField, after the `Deduction` label:

```tsx
                {whtEnabled && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="kind"
                      value="Tax"
                      checked={kind === 'Tax'}
                      onChange={() => setKind('Tax')}
                      className="h-4 w-4 border-line-strong text-primary-600 focus:ring-primary-500"
                    />
                    <span className="font-medium text-amber-700">ภาษีหัก ณ ที่จ่าย</span>
                  </label>
                )}
```

- [ ] **Step 3: Force the frequency when Tax is selected**

Tax is one-time only (Task 2), so the form must not offer a frequency the server will reject. Where `setKind('Tax')` is called, also set the frequency state to `'once'`, and disable the other frequency choices while `kind === 'Tax'`. Find the frequency control with:

```bash
grep -n "frequency" 'src/app/(admin)/admin/payroll/adjustments/adjustment-form.tsx'
```

Add a hint on the frequency field while Tax is selected:

```tsx
{kind === 'Tax' && (
  <p className="mt-1 text-xs text-ink-3">
    ภาษีหัก ณ ที่จ่ายบันทึกครั้งเดียวต่อเดือน — ตัวเลขเปลี่ยนทุกเดือน
  </p>
)}
```

The server-side rule in Task 2 remains the authority; this only stops the form offering a choice that cannot be submitted.

- [ ] **Step 4: Pass the prop from every page that renders the form**

Two pages render it — `src/app/(admin)/admin/payroll/adjustments/new/page.tsx` and
`src/app/(admin)/admin/payroll/adjustments/[id]/page.tsx`. Both are server
components, so in each:

```tsx
const cfg = await prisma.payrollConfig.findFirst({ select: { whtEnabled: true } });
// …
<AdjustmentForm … whtEnabled={cfg?.whtEnabled ?? false} />
```

`?? false` because `findFirst` is nullable and the safe direction is off.

- [ ] **Step 5: Typecheck — the required prop finds every call site**

Run: `pnpm typecheck`
Expected: PASS once every page passes it. Any error is a page you missed; that is the prop being required doing its job.

- [ ] **Step 6: Verify both states in the browser**

With `whtEnabled: false` in the local config, open `/admin/payroll/adjustments/new`. Expected: two radios, no Tax. Turn the switch on in `/admin/settings/payroll`, reload. Expected: three radios; selecting ภาษีหัก ณ ที่จ่าย pins the frequency to once. Submit one, and confirm the row lands with `kind = 'Tax'`:

```bash
grep -n "" /dev/null  # then read the row via prisma studio or a $queryRaw script inside the repo
```

Turn the switch back off when done.

- [ ] **Step 7: Full gate and commit**

```bash
npx vitest run && pnpm typecheck && npx biome check src
git add 'src/app/(admin)/admin/payroll/adjustments/adjustment-form.tsx' <the pages you changed>
git commit -m "feat(payroll): a Tax option in the adjustment form, behind the switch

Third radio, rendered only when PayrollConfig.whtEnabled is on, and it
pins the frequency to 'once' so the form cannot offer a shape the server
will reject.

whtEnabled is a REQUIRED prop rather than defaulting to false: a page
that forgot to pass it would silently hide the option, and 'the option
is missing' looks exactly like 'the switch is off' to whoever is at the
screen. Required makes the typechecker enumerate the call sites."
```

---

### Task 4: Guard against tax filed as a plain Deduction (spec §4.4)

**Files:**
- Modify: `src/app/(admin)/admin/payroll/adjustments/adjustment-schema.ts`
- Modify: `src/app/(admin)/admin/payroll/adjustments/adjustment-schema.test.ts`

**Interfaces:**
- Consumes: the schema from Task 2.
- Produces: a `Deduction` whose reason reads as tax is rejected with a message naming the right kind.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe('adjustment readForm — misfiled tax guard', () => {
  const cases = [
    'ภาษีหัก ณ ที่จ่าย',
    'ภาษี',
    'หัก ณ ที่จ่าย',
    'ภงด 1',
    'ภ.ง.ด.1',
    'withholding tax',
    'WHT',
  ];

  for (const reason of cases) {
    it(`rejects a Deduction reading as tax: ${reason}`, () => {
      // The failure mode routing tax through PayrollAdjustment introduces:
      // entered as a Deduction out of habit, it lands in deductOther, and
      // ภ.ง.ด.1 under-reports with nothing to show anything went wrong.
      const r = readForm(fd({ ...BASE, reason, kind: 'Deduction', frequency: 'once' }));
      expect(r.success, reason).toBe(false);
      if (!r.success) expect(r.error).toContain('ภาษีหัก ณ ที่จ่าย');
    });
  }

  it('allows the same reasons under the Tax kind', () => {
    const r = readForm(
      fd({ ...BASE, reason: 'ภาษีหัก ณ ที่จ่าย', kind: 'Tax', frequency: 'once' }),
    );
    expect(r.success).toBe(true);
  });

  it('does not catch unrelated deductions', () => {
    // Over-matching would block legitimate entries and teach admins to work
    // around the guard, which is worse than not having it. These four are
    // real reasons read out of prod.
    for (const reason of ['ค่าเช่าห้อง+น้ำไฟ', 'หัก เงินยืม', 'วีซ่า 5/6', 'ซื้อจอ']) {
      const r = readForm(fd({ ...BASE, reason, kind: 'Deduction', frequency: 'once' }));
      expect(r.success, reason).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/\(admin\)/admin/payroll/adjustments/adjustment-schema.test.ts`
Expected: the seven rejection cases FAIL (they currently parse fine); the two allow-cases pass.

- [ ] **Step 3: Implement the guard**

In the same `.superRefine`, after the Tax-frequency rule:

```ts
    // Tax entered as a plain Deduction is the failure mode this design
    // introduces: it lands in deductOther, ภ.ง.ด.1 under-reports, and nothing
    // complains. Rejected rather than silently reclassified — the admin's
    // intent should be explicit, and a system that quietly rewrites what
    // someone typed is worse than one that asks.
    const TAX_REASON = /ภาษี|หัก ณ ที่จ่าย|ภ\.?ง\.?ด|withholding|\bwht\b/i;
    if (data.kind === 'Deduction' && TAX_REASON.test(data.reason)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'รายการนี้ดูเหมือนภาษีหัก ณ ที่จ่าย — กรุณาเลือกประเภท "ภาษีหัก ณ ที่จ่าย"',
      });
    }
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/app/\(admin\)/admin/payroll/adjustments/adjustment-schema.test.ts`
Expected: PASS. If `ภงด 1` still slips through, the `ภ\.?ง\.?ด` alternation is the part to check — it must match both the spaced and dotted forms.

- [ ] **Step 5: Confirm the guard is reachable when the switch is off**

Add one more test:

```ts
  it('still guards when withholding is switched off', () => {
    // The schema knows nothing about whtEnabled, and should not: a misfiled
    // tax deduction is wrong whether or not the module is on, and it would
    // otherwise sit in deductOther waiting to be found after the switch flips.
    const r = readForm(
      fd({ ...BASE, reason: 'ภาษีหัก ณ ที่จ่าย', kind: 'Deduction', frequency: 'once' }),
    );
    expect(r.success).toBe(false);
  });
```

Run the file again. Expected: PASS.

- [ ] **Step 6: Full gate and commit**

```bash
npx vitest run && pnpm typecheck && npx biome check src
git add 'src/app/(admin)/admin/payroll/adjustments/adjustment-schema.ts' \
  'src/app/(admin)/admin/payroll/adjustments/adjustment-schema.test.ts'
git commit -m "feat(payroll): reject tax filed as a plain Deduction

The failure mode routing tax through PayrollAdjustment introduces: an
admin enters it as a Deduction out of habit, it lands in deductOther,
ภ.ง.ด.1 under-reports, and nothing complains.

Rejected with a message naming the right kind, not silently
reclassified — a system that quietly rewrites what someone typed is
worse than one that asks.

The regex is deliberately narrow and pinned in both directions: seven
tax spellings must be caught, and four real prod deduction reasons
(ค่าเช่าห้อง+น้ำไฟ, หัก เงินยืม, วีซ่า 5/6, ซื้อจอ) must not be.
Over-matching would block legitimate entries and teach admins to work
around the guard.

Applies regardless of whtEnabled: a misfiled tax deduction is wrong
whether or not the module is on, and would otherwise sit in deductOther
waiting to be found after the switch flips."
```

---

## Self-Review

**Spec coverage.** §4.2's `whtEnabled` gate becomes reachable → Task 1. §3's "recurrence: one-time only" → Task 2. §5 M2's "Tax in the adjustment form, hidden while whtEnabled is false" → Task 3. §4.4's misfiled-`Deduction` guard → Task 4.

**Deferred to M2b, deliberately:** `taxBorneByEmployer` on the employee form and the bulk action, the payslip tax line with its six locale strings, and the payroll-run column. Split because M2a is server-side and testable in unit tests, while M2b is display work whose main cost is i18n (`messages.test.ts` compares every leaf key across all six locales, so a payslip line fails the suite until th/en/my/lo/zh-CN/km all carry it).

**One risk M2a leaves open.** After M2a a `Tax` adjustment can be created and `deductTax` will be computed and stored — but **nothing displays it**. The payslip, the payroll run screen and the reconcile view are all still blind to it. With `whtEnabled` shipping off that is harmless, but it means M2a must not be the point at which the switch is turned on. M2b is.

**Type consistency.** `whtEnabled` is the name in the schema, `toPayrollConfigData`, the form field's `name` attribute and the `AdjustmentForm` prop. `Tax` matches `AdjustmentKind.Tax` from migration 0051 and the `'Income' | 'Deduction' | 'Tax'` unions M1 widened.

**Corrections made during self-review, by reading the code rather than assuming it.**
The first draft of Tasks 2 and 4 tested `adjustmentSchema.safeParse(...)`. There is
no such export — `const Schema` is private and the public API is
`readForm(formData: FormData)`, returning `{ success, error: string }`. Every
assertion on `error.issues[0].path` was therefore against an API that does not
exist, and would have failed to compile. Both blocks now use the `fd()` helper and
`BASE` fixture the existing test file already defines, and assert on message text.
The money-config fixture is `VALID`, not `VALID_INPUT`. The two pages rendering
`AdjustmentForm` are named rather than left to a grep.

**One remaining instruction to resolve by reading.** Task 3 Step 3 says to grep for
the form's frequency control rather than quoting it, because that markup was not
read while planning. The grep is exact and the code around it is quoted; it is a
flagged exception, not licence to improvise elsewhere.
