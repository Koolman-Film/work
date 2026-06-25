# Downloadable PDF Payslip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff download a formal, multi-language (native + English) PDF of a published payslip from the LIFF payslip page, rendered server-side via headless Chromium and archived in Supabase Storage.

**Architecture:** A Node route handler (`GET /liff/payslip/pdf`) assembles a typed `PayslipDocument` from the frozen `Payroll` row (shared with the page so they cannot diverge), renders it to PDF with Chromium (HTML template, repeating `<thead>` header + pinned `footerTemplate`), caches the bytes in a private `payslips` Storage bucket, and 302-redirects to a short-lived signed download URL. Each download is audited.

**Tech Stack:** Next.js 16 App Router (Node runtime), Prisma → Supabase Postgres + Storage, `puppeteer-core` + `@sparticuz/chromium`, next-intl, Vitest. Package manager: **pnpm**.

## Global Constraints

- Engine: **headless Chromium**, server-side, Node runtime (`export const runtime = 'nodejs'`).
- Only `Published` / `Locked` payrolls are downloadable; a staff member can fetch **only their own** slip (use the session `employee.id`, never a request param).
- **Letter-spacing / `text-transform:uppercase` is applied ONLY to Latin (`.t2`/English) classes — NEVER to `.t1` or any element containing Thai/Khmer/Myanmar/Lao** (tracking breaks cluster shaping). This is the load-bearing rendering invariant.
- Money formatted via existing `formatMoney(value, locale)`; all numeric columns use `font-variant-numeric:tabular-nums`.
- Per-locale fonts: inline **Latin + the request locale's script only** as base64 `@font-face` (CJK loads only for `zh-CN`).
- Cache key: `payslips/{employeeId}/{YYYY-MM}.pdf` in a **private** bucket; signed URLs TTL 5 min, `download: true`.
- 6 locales: `th, en, my, lo, zh-CN, km`. Reference prototype (validated, throwaway, **not shipped**): `scripts/sample-payslip-pdf.mjs`.
- Audit each download: `payslip.download`, fire-and-forget.
- Integration tests run against the `koolman_test` DB (`vitest.integration.config.ts`); follow the `reset()` wipe-order pattern in `tests/integration/payroll-pipeline.integration.test.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `messages/*.json` | `payslipPdf` namespace (letterhead + detail templates), 6 locales |
| `src/lib/payslip/document.ts` | `getPayslipDocument(employeeId, month)` → typed `PayslipDocument` (shared with page) |
| `src/lib/payslip/fonts.ts` | `fontFaceCss(locale)` → base64 `@font-face` for Latin + locale script |
| `src/lib/payslip/render-html.ts` | `buildPayslipHtml(doc, opts)` → pure HTML string (+ `PAYSLIP_CSS`) |
| `src/lib/payslip/pdf.ts` | `renderPayslipPdf(html)` → `Buffer` via puppeteer-core/@sparticuz/chromium |
| `src/lib/payslip/storage.ts` | `getOrRenderPayslipPdf(...)`, `invalidatePayslipPdf(...)`; `payslips` bucket |
| `src/app/(liff)/liff/payslip/pdf/route.ts` | `GET` handler: authz → document → cache/render → audit → 302 |
| `src/app/(liff)/liff/payslip/page.tsx` | "Download PDF" button; adopt `getPayslipDocument` |
| `src/lib/audit/log.ts` | add `'payslip.download'` to `AuditAction` |
| `src/lib/payroll/run.ts` | call `invalidatePayslipPdf` on unlock/revise |
| `prisma/migrations/<n>_payslips_bucket/migration.sql` | create private `payslips` bucket |
| `src/lib/payslip/fonts/` | bundled Noto `.ttf` assets |

---

## Task 1: i18n — `payslipPdf` namespace

**Files:**
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json`
- Test: `src/lib/payslip/i18n.test.ts`

**Interfaces:**
- Produces: the `payslipPdf` message namespace with keys `employee, employeeId, payPeriod, payType, generatedOn, issued, disclaimer, kept, download` and detail templates `detail.sso, detail.advance, detail.leave`.

- [ ] **Step 1: Write the failing test** — every locale must define the full namespace with identical key sets.

```ts
// src/lib/payslip/i18n.test.ts
import { describe, expect, it } from 'vitest';
const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const;
const KEYS = ['employee','employeeId','payPeriod','payType','generatedOn','issued','disclaimer','kept','download'];
const DETAIL = ['sso','advance','leave'];
describe('payslipPdf i18n', () => {
  for (const l of LOCALES) {
    it(`${l} has the full payslipPdf namespace`, async () => {
      const m = (await import(`../../../messages/${l}.json`)).default;
      expect(m.payslipPdf, `${l} payslipPdf`).toBeDefined();
      for (const k of KEYS) expect(m.payslipPdf[k], `${l}.payslipPdf.${k}`).toBeTruthy();
      for (const k of DETAIL) expect(m.payslipPdf.detail?.[k], `${l}.payslipPdf.detail.${k}`).toBeTruthy();
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/payslip/i18n.test.ts`
Expected: FAIL — `payslipPdf` undefined.

- [ ] **Step 3: Add the namespace to each `messages/<locale>.json`.** Use these values (detail templates use ICU vars; keep numbers language-neutral). English shown; translate the labels per locale (the sample translations in `scripts/sample-payslip-pdf.mjs` `EXTRA` are the approved source for `employee/employeeId/payPeriod/generatedOn/disclaimer/kept`):

```jsonc
// en.json — add at top level
"payslipPdf": {
  "employee": "Employee",
  "employeeId": "Employee ID",
  "payPeriod": "Pay period",
  "payType": "Pay type",
  "generatedOn": "Generated on",
  "issued": "Issued",
  "disclaimer": "This is a system-generated document. No signature required.",
  "kept": "Take-home",
  "download": "Download PDF",
  "detail": {
    "sso": "{pct}% · cap ฿{cap}",
    "advance": "{count}× advance",
    "leave": "{minutes} min × ฿{rate}"
  }
}
```

For `th/my/lo/zh-CN/km`, copy the label strings from the matching `EXTRA[locale]` object in `scripts/sample-payslip-pdf.mjs` (`employee`, `employeeId`, `payPeriod`, `generatedOn`, `disclaimer`, `kept`), add `payType` (reuse `profile.readonly.payType` from the same locale file), `issued` (e.g. th `"ออกแล้ว"`, zh-CN `"已签发"`, my `"ထုတ်ပြီး"`, lo `"ອອກແລ້ວ"`, km `"បានចេញ"`), `download` (th `"ดาวน์โหลด PDF"`, zh-CN `"下载 PDF"`, my `"PDF ဒေါင်းလုဒ်"`, lo `"ດາວໂຫຼດ PDF"`, km `"ទាញយក PDF"`). The `detail.*` templates stay identical to English in every locale (numeric/units only).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/payslip/i18n.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add messages/*.json src/lib/payslip/i18n.test.ts
git commit -m "i18n(payslip): add payslipPdf namespace (6 locales)"
```

---

## Task 2: `PayslipDocument` assembler

**Files:**
- Create: `src/lib/payslip/document.ts`
- Test: `tests/integration/payslip-document.integration.test.ts`

**Interfaces:**
- Consumes: `prisma`, existing `adjustmentAppliesToMonth` (`@/lib/payroll/adjustments`), `perMinuteRate` (`@/lib/leave/over-quota`), `standardDayMinutes` (`@/lib/leave/units`).
- Produces:
```ts
export type PayslipLine = {
  key: string;
  labelKey?: string;          // payslip.* key when it's a fixed bucket
  label?: string;             // literal (adjustment reason)
  amount: number;
  detail?: { key: string; vars: Record<string, string | number> } | null;
};
export type PayslipDocument = {
  meta: { employeeName: string; employeeId: string; branch: string; department: string | null;
          payType: 'Monthly' | 'Daily' | 'Hourly'; month: string };
  income: { lines: PayslipLine[]; total: number };
  deduct: { lines: PayslipLine[]; total: number };
  net: number;
};
export async function getPayslipDocument(employeeId: string, month: string): Promise<PayslipDocument | null>;
```
Returns `null` when there is no `Published`/`Locked` payroll for `(employeeId, month)`.

- [ ] **Step 1: Write the failing integration test.** Build a published payroll with a zero-quota over-quota leave (rate 1.0 fixture) + a swept advance, assert the document lines/details.

```ts
// tests/integration/payslip-document.integration.test.ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getPayslipDocument } from '@/lib/payslip/document';

const MONTH = '2026-06';
const uid = () => crypto.randomUUID();

async function reset() {
  for (const t of [prisma.payrollAdjustment, prisma.payroll, prisma.recurringDeduction,
    prisma.overtimeEntry, prisma.attendance, prisma.cashAdvance, prisma.leaveRequest,
    prisma.leaveEntitlement, prisma.employee, prisma.user, prisma.leaveType,
    prisma.branch, prisma.payrollConfig, prisma.leaveConfig]) await t.deleteMany({});
  await prisma.leaveConfig.create({ data: {} });
  await prisma.payrollConfig.create({ data: {
    ssoRate: new Prisma.Decimal('0.05'), ssoSalaryCap: new Prisma.Decimal(15_000),
    ssoAmountCap: new Prisma.Decimal(750), otMultiplier: new Prisma.Decimal('1.5'),
    absentDeductionPerDay: new Prisma.Decimal(500), lateDeduction: new Prisma.Decimal(100),
    earlyLeaveDeduction: new Prisma.Decimal(100), workingDaysPerMonth: 30 } });
}
beforeEach(reset);
afterAll(async () => { await prisma.$disconnect(); });

async function makeEmp() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: 'Chiang Mai' } });
  return prisma.employee.create({ data: {
    userId: user.id, firstName: 'Somchai', lastName: 'Jaidee', nickname: 'สมชาย',
    branchId: branch.id, salaryType: 'Monthly', baseSalary: new Prisma.Decimal(12_600),
    status: 'Active', hiredAt: new Date('2026-01-01') } });
}

describe('getPayslipDocument', () => {
  it('returns null when no published payroll exists', async () => {
    const emp = await makeEmp();
    expect(await getPayslipDocument(emp.id, MONTH)).toBeNull();
  });

  it('assembles income/deduction lines with SSO + leave + advance details', async () => {
    const emp = await makeEmp();
    const payroll = await prisma.payroll.create({ data: {
      employeeId: emp.id, month: MONTH, status: 'Published', publishedAt: new Date(),
      incomeBase: new Prisma.Decimal(12_600), incomeOther: new Prisma.Decimal(0),
      deductSso: new Prisma.Decimal(630), deductAdvance: new Prisma.Decimal(2_000),
      deductAttendance: new Prisma.Decimal(0), deductLeave: new Prisma.Decimal(60),
      deductDebt: new Prisma.Decimal(0), deductOther: new Prisma.Decimal(0),
      netPay: new Prisma.Decimal(9_910) } });
    await prisma.cashAdvance.create({ data: { employeeId: emp.id, amount: new Prisma.Decimal(2_000),
      status: 'Approved', deductedInPayrollId: payroll.id } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลากิจ', overQuotaPolicy: 'DeductPay', annualQuota: 0 } });
    await prisma.leaveRequest.create({ data: { employeeId: emp.id, leaveTypeId: lt.id,
      startDate: new Date('2026-06-09'), endDate: new Date('2026-06-09'), reason: 'x',
      status: 'Approved', chargedMinutes: 60, overQuotaMinutes: 60,
      deductAmount: new Prisma.Decimal(60), deductedInPayrollId: payroll.id } });

    const doc = await getPayslipDocument(emp.id, MONTH);
    expect(doc).not.toBeNull();
    expect(doc!.income.total).toBe(12_600);
    expect(doc!.deduct.total).toBe(2_690);
    expect(doc!.net).toBe(9_910);
    const sso = doc!.deduct.lines.find((l) => l.key === 'sso');
    expect(sso?.detail).toEqual({ key: 'sso', vars: { pct: 5, cap: '15,000' } });
    const leave = doc!.deduct.lines.find((l) => l.key === 'leave');
    expect(leave?.detail?.vars.minutes).toBe(60);
    const adv = doc!.deduct.lines.find((l) => l.key === 'advance');
    expect(adv?.detail?.vars.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-document`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `getPayslipDocument`.**

```ts
// src/lib/payslip/document.ts
import { prisma } from '@/lib/db/prisma';
import { perMinuteRate } from '@/lib/leave/over-quota';
import { standardDayMinutes } from '@/lib/leave/units';
import { adjustmentAppliesToMonth } from '@/lib/payroll/adjustments';
import type { PayslipDocument, PayslipLine } from './types';

export type { PayslipDocument, PayslipLine } from './types';

export async function getPayslipDocument(
  employeeId: string,
  month: string,
): Promise<PayslipDocument | null> {
  const payroll = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { in: ['Published', 'Locked'] } },
  });
  if (!payroll) return null;

  const [employee, config, leaveConfig, adjustments, advances, leaves] = await Promise.all([
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, nickname: true, salaryType: true,
        baseSalary: true, branch: { select: { name: true } },
        department: { select: { name: true } } },
    }),
    prisma.payrollConfig.findFirstOrThrow(),
    prisma.leaveConfig.findFirst(),
    prisma.payrollAdjustment.findMany({
      where: { employeeId, startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }], deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, reason: true, amount: true, startMonth: true, endMonth: true },
    }),
    prisma.cashAdvance.findMany({ where: { deductedInPayrollId: payroll.id },
      select: { amount: true } }),
    prisma.leaveRequest.findMany({ where: { deductedInPayrollId: payroll.id },
      select: { overQuotaMinutes: true } }),
  ]);

  const n = (d: { toNumber(): number }) => d.toNumber();
  const std = standardDayMinutes(leaveConfig ?? { morningStart: '09:00', morningEnd: '12:00',
    afternoonStart: '13:00', afternoonEnd: '17:00' });

  // ── Income
  const income: PayslipLine[] = [{ key: 'base', labelKey: 'income.base', amount: n(payroll.incomeBase), detail: null }];
  const incomeAdj = adjustments.filter((a) => a.kind === 'Income' && adjustmentAppliesToMonth(a, month));
  const incomeAdjSum = incomeAdj.reduce((s, a) => s + n(a.amount), 0);
  if (incomeAdj.length > 0 && incomeAdjSum === n(payroll.incomeOther)) {
    for (const a of incomeAdj) income.push({ key: a.id, label: a.reason, amount: n(a.amount), detail: null });
  } else if (n(payroll.incomeOther) !== 0) {
    income.push({ key: 'other', labelKey: 'income.other', amount: n(payroll.incomeOther), detail: null });
  }

  // ── Deductions (with details where derivable)
  const deduct: PayslipLine[] = [];
  const push = (key: string, labelKey: string, amount: number, detail: PayslipLine['detail'] = null) => {
    if (amount !== 0) deduct.push({ key, labelKey, amount, detail });
  };
  const ssoDetail = n(payroll.deductSso) !== 0
    ? { key: 'sso', vars: { pct: Math.round(n(config.ssoRate) * 100),
        cap: n(config.ssoSalaryCap).toLocaleString('en-US') } } : null;
  push('sso', 'deduct.sso', n(payroll.deductSso), ssoDetail);

  const advDetail = advances.length > 0 ? { key: 'advance', vars: { count: advances.length } } : null;
  push('advance', 'deduct.advance', n(payroll.deductAdvance), advDetail);

  push('attendance', 'deduct.attendance', n(payroll.deductAttendance)); // detail deferred

  const totalOver = leaves.reduce((s, l) => s + (l.overQuotaMinutes ?? 0), 0);
  const rate = perMinuteRate(employee.salaryType, n(employee.baseSalary), config.workingDaysPerMonth, std);
  const leaveDetail = totalOver > 0
    ? { key: 'leave', vars: { minutes: totalOver, rate: rate.toFixed(4) } } : null;
  push('leave', 'deduct.leave', n(payroll.deductLeave), leaveDetail);

  push('debt', 'deduct.debt', n(payroll.deductDebt)); // detail deferred

  const deductAdj = adjustments.filter((a) => a.kind === 'Deduction' && adjustmentAppliesToMonth(a, month));
  const deductAdjSum = deductAdj.reduce((s, a) => s + n(a.amount), 0);
  if (deductAdj.length > 0 && deductAdjSum === n(payroll.deductOther)) {
    for (const a of deductAdj) deduct.push({ key: a.id, label: a.reason, amount: n(a.amount), detail: null });
  } else if (n(payroll.deductOther) !== 0) {
    deduct.push({ key: 'other', labelKey: 'deduct.other', amount: n(payroll.deductOther), detail: null });
  }

  return {
    meta: {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeId, branch: employee.branch.name, department: employee.department?.name ?? null,
      payType: employee.salaryType, month,
    },
    income: { lines: income, total: n(payroll.incomeBase) + n(payroll.incomeOther) },
    deduct: { lines: deduct, total: [payroll.deductSso, payroll.deductAdvance, payroll.deductAttendance,
      payroll.deductLeave, payroll.deductDebt, payroll.deductOther].reduce((s, d) => s + n(d), 0) },
    net: n(payroll.netPay),
  };
}
```

Also create `src/lib/payslip/types.ts` with the `PayslipLine` / `PayslipDocument` types from the Interfaces block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-document`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm tsc --noEmit
git add src/lib/payslip/types.ts src/lib/payslip/document.ts tests/integration/payslip-document.integration.test.ts
git commit -m "feat(payslip): PayslipDocument assembler (shared data source)"
```

---

## Task 3: Per-locale font `@font-face`

**Files:**
- Create: `src/lib/payslip/fonts.ts`, font assets under `src/lib/payslip/fonts/*.ttf`
- Test: `src/lib/payslip/fonts.test.ts`

**Interfaces:**
- Produces: `export function fontFaceCss(locale: string): string;` — returns `@font-face` rules (base64 data URIs) for Noto Sans (Latin, always) + the one script font for `locale` (`th`→Thai, `lo`→Lao, `my`→Myanmar, `km`→Khmer, `zh-CN`→SC, `en`→none extra). Also `export const FONT_STACK: string`.

- [ ] **Step 1: Add the font assets.** Download the regular+bold `.ttf` for Noto Sans, Noto Sans Thai, Noto Sans Lao, Noto Sans Myanmar, Noto Sans Khmer, Noto Sans SC into `src/lib/payslip/fonts/` (e.g. via `pnpm dlx google-font-installer` or commit from https://fonts.google.com). Keep filenames: `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `NotoSansThai-Regular.ttf`, … `NotoSansSC-Regular.ttf`.

- [ ] **Step 2: Write the failing test.**

```ts
// src/lib/payslip/fonts.test.ts
import { describe, expect, it } from 'vitest';
import { fontFaceCss } from './fonts';
describe('fontFaceCss', () => {
  it('always includes Noto Sans (Latin) as base64', () => {
    expect(fontFaceCss('en')).toContain("font-family: 'Noto Sans'");
    expect(fontFaceCss('en')).toContain('data:font/ttf;base64,');
  });
  it('includes the Thai font for th but not the CJK font', () => {
    const css = fontFaceCss('th');
    expect(css).toContain("font-family: 'Noto Sans Thai'");
    expect(css).not.toContain("font-family: 'Noto Sans SC'");
  });
  it('includes the CJK font only for zh-CN', () => {
    expect(fontFaceCss('zh-CN')).toContain("font-family: 'Noto Sans SC'");
    expect(fontFaceCss('km')).not.toContain("font-family: 'Noto Sans SC'");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/payslip/fonts.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `fonts.ts`.**

```ts
// src/lib/payslip/fonts.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'src/lib/payslip/fonts');
const b64 = (f: string) => readFileSync(path.join(DIR, f)).toString('base64');
const face = (family: string, file: string, weight: number) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;` +
  `src:url(data:font/ttf;base64,${b64(file)}) format('truetype');}`;

const SCRIPT: Record<string, { family: string; reg: string; bold: string }> = {
  th: { family: 'Noto Sans Thai', reg: 'NotoSansThai-Regular.ttf', bold: 'NotoSansThai-Bold.ttf' },
  lo: { family: 'Noto Sans Lao', reg: 'NotoSansLao-Regular.ttf', bold: 'NotoSansLao-Bold.ttf' },
  my: { family: 'Noto Sans Myanmar', reg: 'NotoSansMyanmar-Regular.ttf', bold: 'NotoSansMyanmar-Bold.ttf' },
  km: { family: 'Noto Sans Khmer', reg: 'NotoSansKhmer-Regular.ttf', bold: 'NotoSansKhmer-Bold.ttf' },
  'zh-CN': { family: 'Noto Sans SC', reg: 'NotoSansSC-Regular.ttf', bold: 'NotoSansSC-Bold.ttf' },
};

export const FONT_STACK =
  "'Noto Sans','Noto Sans Thai','Noto Sans Lao','Noto Sans Myanmar','Noto Sans Khmer','Noto Sans SC',sans-serif";

export function fontFaceCss(locale: string): string {
  const out = [face('Noto Sans', 'NotoSans-Regular.ttf', 400), face('Noto Sans', 'NotoSans-Bold.ttf', 700)];
  const s = SCRIPT[locale];
  if (s) { out.push(face(s.family, s.reg, 400), face(s.family, s.bold, 700)); }
  return out.join('\n');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/payslip/fonts.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payslip/fonts.ts src/lib/payslip/fonts.test.ts src/lib/payslip/fonts/
git commit -m "feat(payslip): per-locale base64 @font-face loader"
```

---

## Task 4: HTML builder (`buildPayslipHtml`)

**Files:**
- Create: `src/lib/payslip/render-html.ts`
- Test: `src/lib/payslip/render-html.test.ts`

**Interfaces:**
- Consumes: `PayslipDocument` (Task 2), `FONT_STACK` + `fontFaceCss` (Task 3).
- Produces:
```ts
export function buildPayslipHtml(doc: PayslipDocument, opts: {
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;   // payslip.* + detail.* (locale)
  tEn: (key: string) => string;          // payslip.* in English (for the .t2 second line)
  money: (n: number) => string;          // formatMoney bound to the locale
  fontFace: string;     // fontFaceCss(locale)
  logoSvg: string;      // inline SVG or <img> data-uri
  periodLabel: string;  // already-localized month label
  generatedAt: string;
}): string;
```

- [ ] **Step 1: Write the failing test** — the load-bearing invariant: native labels are never letter-spaced/uppercased; English micro-labels are.

```ts
// src/lib/payslip/render-html.test.ts
import { describe, expect, it } from 'vitest';
import { buildPayslipHtml } from './render-html';
import type { PayslipDocument } from './types';

const doc: PayslipDocument = {
  meta: { employeeName: 'Somchai Jaidee', employeeId: 'EMP-1', branch: 'Chiang Mai',
    department: 'Install', payType: 'Monthly', month: '2026-06' },
  income: { lines: [{ key: 'base', labelKey: 'income.base', amount: 20000, detail: null }], total: 20000 },
  deduct: { lines: [{ key: 'sso', labelKey: 'deduct.sso', amount: 750,
    detail: { key: 'sso', vars: { pct: 5, cap: '15,000' } } }], total: 750 },
  net: 19250,
};
const t = (k: string, v?: Record<string, string | number>) =>
  k === 'detail.sso' ? `${v!.pct}% · cap ฿${v!.cap}` : k; // echo key
const opts = { t, fontFace: '/*f*/', logoSvg: '<svg/>', periodLabel: 'มิถุนายน 2569', generatedAt: '2026-07-01' };

describe('buildPayslipHtml', () => {
  it('renders a detail line only when present', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'en' });
    expect(html).toContain('5% · cap ฿15,000');
  });
  it('NEVER letter-spaces native script — .t1 has no letter-spacing/uppercase', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const t1 = css.match(/\.t1\s*\{[^}]*\}/)![0];
    expect(t1).not.toMatch(/letter-spacing/);
    expect(t1).not.toMatch(/text-transform/);
    const t2 = css.match(/\.t2\s*\{[^}]*\}/)![0];
    expect(t2).toMatch(/letter-spacing/);
    expect(t2).toMatch(/uppercase/);
  });
  it('omits the English second line when locale is en', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'en' });
    expect(html).not.toContain('class="t2"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/payslip/render-html.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `render-html.ts`.** Port the validated template from `scripts/sample-payslip-pdf.mjs`: copy its `<style>` block verbatim into a `PAYSLIP_CSS` string (prepend `${opts.fontFace}`), and convert its `buildHtml` body into `buildPayslipHtml` driven by `doc`. Keep exactly: the `<table class="sheet">` with `<thead>` (logo + company + PAYSLIP + period) and `<tbody>` (summary strip, take-home bar, employee card, two-column earnings|deductions cards, net hero, closing mark with disclaimer + ISSUED seal). The footer is NOT in the HTML (drawn by `footerTemplate` in Task 5). Label/line helpers:

```ts
// dual-language helpers (locale-aware)
const isEn = locale === 'en';
const label = (native: string, en: string) =>
  isEn ? `<span class="t1">${en}</span>` : `<span class="t1">${native}</span><span class="t2">${en}</span>`;
const lineRow = (cls: 'pos' | 'neg', l: PayslipLine) => {
  const native = l.label ?? t(l.labelKey!);        // payslip.* localized
  const en = l.label ?? tEnglish(l.labelKey!);     // English copy of the same key
  const detail = l.detail ? `<span class="dt">${t(`detail.${l.detail.key}`, l.detail.vars)}</span>` : '';
  return `<tr><td class="cell">${label(native, en)}</td>` +
    `<td class="amt ${cls}">${cls === 'neg' ? '−' : ''}${money(l.amount)}${detail}</td></tr>`;
};
```

The English second line needs the English copy of each `payslip.*` key. Pass a second translator: extend `opts` with `tEn: (key) => string` (an `en`-locale `getTranslations` bound in the route, Task 7). Update the `opts` type + test `tEn` accordingly. `money` uses the route-provided `formatMoney`-bound function — add `opts.money: (n:number)=>string`. The CRITICAL CSS rule (copy verbatim, do not relax):

```css
.t1{display:block;font-weight:500;}                       /* native — NO letter-spacing/transform */
.t2{display:block;font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);
    font-weight:500;line-height:1.3;margin-top:1px;}      /* Latin micro-label only */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/payslip/render-html.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payslip/render-html.ts src/lib/payslip/render-html.test.ts
git commit -m "feat(payslip): HTML template builder (dual-language, thead header)"
```

---

## Task 5: PDF renderer (Chromium)

**Files:**
- Create: `src/lib/payslip/pdf.ts`
- Modify: `package.json` (add deps)
- Test: `tests/integration/payslip-pdf.integration.test.ts`

**Interfaces:**
- Consumes: `buildPayslipHtml` output (an HTML string).
- Produces: `export async function renderPayslipPdf(html: string): Promise<Buffer>;` — A4, `printBackground`, repeating header from `<thead>`, pinned footer via `footerTemplate` (company · generated · `Page X / Y`), margins `{top:13mm,bottom:15mm,left:13mm,right:13mm}`.

- [ ] **Step 1: Add dependencies**

Run: `pnpm add puppeteer-core @sparticuz/chromium`
Expected: both added to `dependencies`.

- [ ] **Step 2: Write the failing smoke test** — bytes are a valid multi-page-capable PDF.

```ts
// tests/integration/payslip-pdf.integration.test.ts
import { describe, expect, it } from 'vitest';
import { renderPayslipPdf } from '@/lib/payslip/pdf';

describe('renderPayslipPdf', () => {
  it('produces a valid PDF from HTML', async () => {
    const html = `<!doctype html><html><head><style>@page{size:A4}</style></head>
      <body><table class="sheet"><thead><tr><th>H</th></tr></thead>
      <tbody><tr><td><div style="height:1500px">content</div></td></tr></tbody></table></body></html>`;
    const buf = await renderPayslipPdf(html);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-pdf`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `pdf.ts`.** Use `@sparticuz/chromium` on Vercel; a local Chrome channel in dev (detected by absence of `process.env.VERCEL`).

```ts
// src/lib/payslip/pdf.ts
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const FOOTER = `<div style="width:100%;box-sizing:border-box;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#9b9588;letter-spacing:.04em;display:flex;justify-content:space-between;">
  <span>Koolman Co., Ltd.</span>
  <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

async function launch() {
  if (process.env.VERCEL) {
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true });
  }
  // Local dev: use an installed Chrome/Chromium.
  const local = process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.launch({ executablePath: local, headless: true });
}

export async function renderPayslipPdf(html: string): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<div></div>', footerTemplate: FOOTER,
      margin: { top: '13mm', right: '13mm', bottom: '15mm', left: '13mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-pdf`
Expected: PASS (set `CHROME_PATH` if Chrome is elsewhere; CI uses `@sparticuz/chromium`).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/payslip/pdf.ts tests/integration/payslip-pdf.integration.test.ts
git commit -m "feat(payslip): Chromium PDF renderer (thead header + pinned footer)"
```

---

## Task 6: Storage cache + `payslips` bucket

**Files:**
- Create: `prisma/migrations/<timestamp>_payslips_bucket/migration.sql`, `src/lib/payslip/storage.ts`
- Test: `tests/integration/payslip-storage.integration.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdminClient` (`@/lib/supabase/admin`), `renderPayslipPdf`.
- Produces:
```ts
export async function getOrRenderPayslipPdf(args: {
  employeeId: string; month: string; render: () => Promise<Buffer>;
}): Promise<{ signedUrl: string; fromCache: boolean }>;
export async function invalidatePayslipPdf(employeeId: string, month: string): Promise<void>;
```

- [ ] **Step 1: Write the bucket migration.**

```sql
-- prisma/migrations/<timestamp>_payslips_bucket/migration.sql
insert into storage.buckets (id, name, public)
values ('payslips', 'payslips', false)
on conflict (id) do nothing;
```
(No RLS policies needed — access is service-role only via signed URLs, mirroring `attendance-photos`.)

- [ ] **Step 2: Apply it to the test DB**

Run: `pnpm db:test:deploy`
Expected: migration applied; `payslips` bucket row exists.

- [ ] **Step 3: Write the failing test.**

```ts
// tests/integration/payslip-storage.integration.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { getOrRenderPayslipPdf, invalidatePayslipPdf } from '@/lib/payslip/storage';

const EID = '00000000-0000-0000-0000-0000000000aa';
const MONTH = '2026-06';
const fakePdf = () => Promise.resolve(Buffer.from('%PDF-1.4 test'));

describe('payslip storage cache', () => {
  it('renders on miss then serves from cache on hit', async () => {
    await invalidatePayslipPdf(EID, MONTH);
    let rendered = 0;
    const render = () => { rendered++; return fakePdf(); };
    const a = await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });
    expect(a.fromCache).toBe(false);
    expect(a.signedUrl).toContain('token=');
    const b = await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });
    expect(b.fromCache).toBe(true);
    expect(rendered).toBe(1);
    await invalidatePayslipPdf(EID, MONTH);
  });
  afterAll(async () => { await invalidatePayslipPdf(EID, MONTH); });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-storage`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `storage.ts`.**

```ts
// src/lib/payslip/storage.ts
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'payslips';
const TTL = 60 * 5;
const keyFor = (employeeId: string, month: string) => `${employeeId}/${month}.pdf`;

export async function getOrRenderPayslipPdf(args: {
  employeeId: string; month: string; render: () => Promise<Buffer>;
}): Promise<{ signedUrl: string; fromCache: boolean }> {
  const supabase = getSupabaseAdminClient();
  const key = keyFor(args.employeeId, args.month);
  const sign = async () => {
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(key, TTL, { download: true });
    if (error || !data) throw error ?? new Error('sign failed');
    return data.signedUrl;
  };
  // Probe: list the exact object to detect a cache hit.
  const { data: list } = await supabase.storage.from(BUCKET)
    .list(args.employeeId, { search: `${args.month}.pdf` });
  if (list?.some((f) => f.name === `${args.month}.pdf`)) {
    return { signedUrl: await sign(), fromCache: true };
  }
  const buf = await args.render();
  const { error } = await supabase.storage.from(BUCKET)
    .upload(key, buf, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return { signedUrl: await sign(), fromCache: false };
}

export async function invalidatePayslipPdf(employeeId: string, month: string): Promise<void> {
  await getSupabaseAdminClient().storage.from(BUCKET).remove([keyFor(employeeId, month)]);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-storage`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations src/lib/payslip/storage.ts tests/integration/payslip-storage.integration.test.ts
git commit -m "feat(payslip): private payslips bucket + cache-first storage helper"
```

---

## Task 7: Route handler + audit + download button

**Files:**
- Create: `src/app/(liff)/liff/payslip/pdf/route.ts`
- Modify: `src/lib/audit/log.ts`, `src/app/(liff)/liff/payslip/page.tsx`
- Test: `tests/integration/payslip-pdf-route.integration.test.ts`

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth/require-role`), `getPayslipDocument`, `buildPayslipHtml`, `renderPayslipPdf`, `getOrRenderPayslipPdf`, `auditLog`, `getTranslations`/`getLocale` (next-intl/server), `formatMoney` (`@/lib/i18n/format`).
- Produces: `GET` at `/liff/payslip/pdf` → 302 to a signed download URL.

- [ ] **Step 1: Add the audit action.** In `src/lib/audit/log.ts`, add `'payslip.download'` to the `AuditAction` union (after the Payroll block, e.g. below `'payroll.revise'`).

- [ ] **Step 2: Write the failing route test** — authz + 404 + redirect.

```ts
// tests/integration/payslip-pdf-route.integration.test.ts
import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/(liff)/liff/payslip/pdf/route';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ user: { id: 'u1' }, employee: { id: 'emp-none', status: 'Active' } })),
}));

describe('GET /liff/payslip/pdf', () => {
  it('404s when the employee has no published slip for the month', async () => {
    const res = await GET(new Request('http://x/liff/payslip/pdf?m=2099-01'));
    expect(res.status).toBe(404);
  });
  it('400s on a malformed month', async () => {
    const res = await GET(new Request('http://x/liff/payslip/pdf?m=nope'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-pdf-route`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the route.**

```ts
// src/app/(liff)/liff/payslip/pdf/route.ts
import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from '@/lib/payslip/document';
import { fontFaceCss } from '@/lib/payslip/fonts';
import { buildPayslipHtml } from '@/lib/payslip/render-html';
import { renderPayslipPdf } from '@/lib/payslip/pdf';
import { getOrRenderPayslipPdf } from '@/lib/payslip/storage';
import { payslipLogoSvg, payslipPeriodLabel } from '@/lib/payslip/letterhead'; // small helpers (period label + logo)

export const runtime = 'nodejs';
export const maxDuration = 60;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request): Promise<Response> {
  const { user, employee } = await requireRole(['Staff']);
  if (!employee) return new NextResponse('Not found', { status: 404 });
  const month = new URL(req.url).searchParams.get('m') ?? '';
  if (!MONTH_RE.test(month)) return new NextResponse('Bad month', { status: 400 });

  const doc = await getPayslipDocument(employee.id, month);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const locale = await getLocale();
  const [t, tEn] = await Promise.all([
    getTranslations({ locale, namespace: 'payslip' }),
    getTranslations({ locale: 'en', namespace: 'payslip' }),
  ]);
  const tPdf = await getTranslations({ locale, namespace: 'payslipPdf' });

  const { signedUrl, fromCache } = await getOrRenderPayslipPdf({
    employeeId: employee.id, month,
    render: () => renderPayslipPdf(buildPayslipHtml(doc, {
      locale,
      t: (k, v) => (k.startsWith('detail.') ? tPdf(k as never, v) : t(k as never)),
      tEn: (k) => tEn(k as never),
      money: (n) => formatMoney(n, locale),
      fontFace: fontFaceCss(locale),
      logoSvg: payslipLogoSvg(),
      periodLabel: payslipPeriodLabel(locale, month),
      generatedAt: new Date().toISOString(),
    })),
  });

  auditLog({ actorId: user.id, action: 'payslip.download', entityType: 'Payroll',
    entityId: `${employee.id}:${month}`, metadata: { source: 'liff', month, fromCache } });

  return NextResponse.redirect(signedUrl, 302);
}
```

Also create `src/lib/payslip/letterhead.ts` exporting `payslipLogoSvg()` (the inline SVG from the prototype, or read a bundled raster) and `payslipPeriodLabel(locale, month)` (port `buildMonthLabel` from `page.tsx` — Buddhist year for `th`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-pdf-route`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the download button to the page.** In `src/app/(liff)/liff/payslip/page.tsx`, inside the `{slip && (...)}` block (only when a slip exists), add next to the header:

```tsx
<a
  href={`/liff/payslip/pdf?m=${month}`}
  className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
>
  {tPdf('download')}
</a>
```
Add `const tPdf = await getTranslations('payslipPdf');` alongside the existing `getTranslations('payslip')` call.

- [ ] **Step 7: Typecheck, build, commit**

```bash
pnpm tsc --noEmit && pnpm build
git add src/lib/audit/log.ts "src/app/(liff)/liff/payslip" src/lib/payslip/letterhead.ts tests/integration/payslip-pdf-route.integration.test.ts
git commit -m "feat(payslip): download route + audit + page button"
```

---

## Task 8: Cache invalidation on unlock/revise

**Files:**
- Modify: `src/lib/payroll/run.ts` (the unlock/revise paths)
- Test: extend `tests/integration/payslip-storage.integration.test.ts`

**Interfaces:**
- Consumes: `invalidatePayslipPdf` (Task 6).

- [ ] **Step 1: Locate the unlock/revise functions.**

Run: `grep -n "unlock\|revise\|status: 'Draft'" src/lib/payroll/run.ts`
Expected: the function(s) that flip `Published`/`Locked` → `Draft`.

- [ ] **Step 2: Write the failing test** — invalidation removes the cached object.

```ts
// add to payslip-storage.integration.test.ts
it('invalidate removes the cached object so the next call re-renders', async () => {
  let rendered = 0;
  const render = () => { rendered++; return Promise.resolve(Buffer.from('%PDF-1.4 x')); };
  await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });   // miss → 1
  await invalidatePayslipPdf(EID, MONTH);
  await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });   // miss again → 2
  expect(rendered).toBe(2);
  await invalidatePayslipPdf(EID, MONTH);
});
```

- [ ] **Step 3: Run test to verify it fails (or passes if logic already holds)**

Run: `pnpm vitest run --config vitest.integration.config.ts payslip-storage`
Expected: this case PASSES already (validates Task 6); it guards the contract Task 8 depends on.

- [ ] **Step 4: Wire invalidation into unlock/revise.** For each employee whose `Published`/`Locked` row returns to `Draft`, after the status update call:

```ts
import { invalidatePayslipPdf } from '@/lib/payslip/storage';
// inside the unlock/revise transaction result handling, per affected (employeeId, month):
await invalidatePayslipPdf(employeeId, month);
```
Place it after the DB status change commits (fire-and-forget is acceptable: wrap in `void invalidatePayslipPdf(...).catch(() => {})` so a Storage hiccup never blocks unlock).

- [ ] **Step 5: Run the full payroll + payslip suites**

Run: `pnpm vitest run --config vitest.integration.config.ts payroll-pipeline payslip-storage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/run.ts tests/integration/payslip-storage.integration.test.ts
git commit -m "feat(payslip): bust cached PDF when a month is unlocked/revised"
```

---

## Task 9: Full verification

- [ ] **Step 1: Unit + integration + lint + build**

Run: `pnpm vitest run && pnpm vitest run --config vitest.integration.config.ts && pnpm biome check && pnpm tsc --noEmit && pnpm build`
Expected: all green.

- [ ] **Step 2: Manual smoke (one locale per script).** Set `NEXT_LOCALE` cookie, hit `/liff/payslip/pdf?m=<published month>` for `th`, `km`, `zh-CN`; confirm the PDF downloads, the script shapes correctly, header repeats, footer pinned with page numbers.

- [ ] **Step 3: Commit any fixes, then finish the branch** via `superpowers:finishing-a-development-branch`.

---

## Self-review notes

- **Spec coverage:** engine (Task 5), server-side+archive (6,7), dual-language stacked + letter-spacing invariant (4), letterhead/details (2,4), thead header + pinned footer (4,5), cache + invalidation (6,8), authz own/published-only (7), audit (7), fonts per-locale (3), i18n (1), tests (every task). Deferred attendance/debt details encoded in Task 2 (total-only). Multi-page single-column refinement is out of v1 scope (noted in spec §12).
- **Type consistency:** `PayslipDocument`/`PayslipLine` defined in Task 2 (`types.ts`) and consumed unchanged in Tasks 4 & 7; `getOrRenderPayslipPdf`/`invalidatePayslipPdf` signatures defined in Task 6, used in 7 & 8; `buildPayslipHtml` opts (`t,tEn,money,fontFace,logoSvg,periodLabel,generatedAt`) defined in Task 4 and supplied in Task 7. `renderPayslipPdf(html)` defined in Task 5, used in 7.
- **Open dependency note:** Task 7 references `src/lib/payslip/letterhead.ts` — created within Task 7 Step 4.
