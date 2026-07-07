# Payslip Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browse + re-download surfaces over the existing cached payslip PDFs — an employee "all my payslips" list (LIFF), an admin per-employee history + PDF download, and an admin bulk "download a month's payslips as .zip".

**Architecture:** Reuse the existing payslip pipeline (`getPayslipDocument → resolveLetterhead → buildPayslipHtml → renderPayslipPdf`, cached in Supabase Storage). Extract the render closure once (`buildPayslipRenderClosure`); the single-download route feeds it to `getOrRenderPayslipPdf` (302 → signed URL), the zip route feeds it to a new bytes helper `getPayslipPdfBytes`. New surfaces query historical Published/Locked payroll rows.

**Tech Stack:** Next.js App Router (Route Handlers + server components), Prisma, Supabase Storage (service-role admin client), `@sparticuz/chromium`+`puppeteer-core` (existing), `jszip` (new), Vitest.

## Global Constraints

- **Only `Published`/`Locked` payroll rows** are ever exposed (frozen slips); Drafts never. Guard everywhere via `status: { in: ['Published', 'Locked'] }` (and `getPayslipDocument` already returns `null` otherwise).
- **Do not use `Payroll.pdfUrl`** — it is vestigial (never written). The cache is Supabase Storage bucket `payslips`, key `${employeeId}/${month}.pdf`.
- **Every new PDF-rendering route needs a `next.config.ts` `outputFileTracingIncludes` entry** globbing `./src/lib/payslip/fonts/**` + both chromium bin paths, plus `export const runtime = 'nodejs'` + a `maxDuration`, or it 500s on Vercel. Also **remove the stale `/admin/payroll/preview-pdf` entry** (no such route).
- Admin routes gate `payroll.read` (payslips are payroll data) + branch scope via `getPermittedBranches`/`canActOnEmployeeBranches`. The LIFF list uses the existing `requireEmployee()`.
- Render each slip in the **target employee's own locale** (`User.locale`, validated by `isLocale`, default `'th'`), reference line `refLocale = locale === 'th' ? 'en' : 'th'` — matching the pre-warmed cache.
- Audit downloads via `auditLog({ action: 'payslip.download', entityType: 'Payroll', entityId: '<employeeId>:<month>', metadata: { source, ... } })`; `source` = `'admin-ui'` (single) / `'admin-ui-bulk'` (zip, + `count`).
- `Payroll.netPay` etc. are Prisma `Decimal` → `.toNumber()` before formatting. LIFF uses `formatMoney` (`@/lib/i18n/format`) + a page-local Buddhist-era month label; admin uses `formatTHB2` + `monthLabelTh` (`@/lib/format`).
- Month regex everywhere: `/^\d{4}-(0[1-9]|1[0-2])$/`. UUID regex for `employeeId` params: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

---

### Task 1: `getPayslipPdfBytes` bytes helper

**Files:**
- Modify: `src/lib/payslip/storage.ts`

**Interfaces:**
- Produces: `getPayslipPdfBytes(args: { employeeId: string; month: string; render: () => Promise<Buffer> }): Promise<Buffer>` — returns the cached PDF bytes (download on hit) or renders+caches+returns (miss).

- [ ] **Step 1: Add the function**

Append to `src/lib/payslip/storage.ts` (reusing the module-private `BUCKET`/`keyFor`, mirroring `getOrRenderPayslipPdf`'s hit/miss probe; the download→Blob→Buffer pattern matches `letterhead.ts`):

```ts
/**
 * Like getOrRenderPayslipPdf but returns the raw PDF bytes (for zipping),
 * not a signed URL. Cache hit → download the object; miss → render + upload.
 */
export async function getPayslipPdfBytes(args: {
  employeeId: string;
  month: string;
  render: () => Promise<Buffer>;
}): Promise<Buffer> {
  const supabase = getSupabaseAdminClient();
  const key = keyFor(args.employeeId, args.month);

  const { data: list, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(args.employeeId, { search: `${args.month}.pdf` });
  if (listErr) throw listErr;

  if (list?.some((f) => f.name === `${args.month}.pdf`)) {
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
    // fall through to re-render if the object vanished between list and download
  }

  const buf = await args.render();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buf, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return buf;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (No unit test — pure storage IO; exercised by the zip route's manual pass.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/payslip/storage.ts
git commit -m "feat(payslip): getPayslipPdfBytes — cached PDF bytes for zipping"
```

---

### Task 2: Shared render closure

**Files:**
- Create: `src/lib/payslip/render-closure.ts`

**Interfaces:**
- Consumes: `getPayslipDocument`, `resolveLetterhead`, `payslipPeriodLabel`, `fontFaceCss`, `buildPayslipHtml`, `renderPayslipPdf`, `formatMoney`, `getTranslations`, i18n config, `prisma`.
- Produces: `buildPayslipRenderClosure(employeeId: string, month: string): Promise<{ render: () => Promise<Buffer> } | null>` — `null` when there is no frozen slip.

- [ ] **Step 1: Create the module**

Create `src/lib/payslip/render-closure.ts` (this is the LIFF pdf route's render block, generalized to any employee, resolving that employee's own locale):

```ts
import 'server-only';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { getPayslipDocument } from './document';
import { fontFaceCss } from './fonts';
import { payslipPeriodLabel, resolveLetterhead } from './letterhead';
import { renderPayslipPdf } from './pdf';
import { buildPayslipHtml } from './render-html';

/**
 * Builds the PDF render closure for one employee's frozen (Published/Locked)
 * slip, in that employee's own locale. Returns null if no frozen slip exists.
 * Shared by the admin single-download route (→ getOrRenderPayslipPdf) and the
 * bulk zip route (→ getPayslipPdfBytes).
 */
export async function buildPayslipRenderClosure(
  employeeId: string,
  month: string,
): Promise<{ render: () => Promise<Buffer> } | null> {
  const doc = await getPayslipDocument(employeeId, month);
  if (!doc) return null;

  const [letterhead, emp] = await Promise.all([
    resolveLetterhead(doc.meta.letterhead),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { user: { select: { locale: true } } },
    }),
  ]);

  const locale: Locale = isLocale(emp?.user?.locale) ? (emp.user.locale as Locale) : DEFAULT_LOCALE;
  const refLocale: Locale = locale === 'th' ? 'en' : 'th';
  const [t, tRef] = await Promise.all([
    getTranslations({ locale }),
    getTranslations({ locale: refLocale }),
  ]);

  const render = () =>
    renderPayslipPdf(
      buildPayslipHtml(doc, {
        locale,
        t: (k, v) => t(k as Parameters<typeof t>[0], v as Parameters<typeof t>[1]),
        tRef: (k) => tRef(k as Parameters<typeof tRef>[0]),
        money: (n) => formatMoney(n, locale),
        fontFace: fontFaceCss(locale),
        logoSvg: letterhead.logoHtml,
        companyEn: letterhead.companyEn,
        companyNative: letterhead.companyNative,
        periodLabel: payslipPeriodLabel(locale, month),
        generatedAt: new Date().toISOString(),
      }),
    );

  return { render };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (No unit test — composes IO + Chromium render; verified via the routes' manual pass. Confirm the `@/lib/db/prisma` import path and the `t`/`tRef` cast shape against `liff/payslip/pdf/route.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/payslip/render-closure.ts
git commit -m "feat(payslip): shared render-closure builder (per-employee locale)"
```

---

### Task 3: History loaders

**Files:**
- Create: `src/lib/payslip/history.ts`
- Test: `tests/integration/payslip-history.integration.test.ts`

**Interfaces:**
- Consumes: `prisma`, `viaEmployeeBranchScope` + `PermittedBranches` from `@/lib/auth/branch-scope`.
- Produces:
  - `loadEmployeePayslipHistory(employeeId: string): Promise<{ month: string; netPay: number }[]>` (newest first).
  - `loadMonthPayslipTargets(month: string, permitted: PermittedBranches): Promise<{ employeeId: string; name: string }[]>`.

- [ ] **Step 1: Write the module**

Create `src/lib/payslip/history.ts`:

```ts
import 'server-only';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

export async function loadEmployeePayslipHistory(
  employeeId: string,
): Promise<{ month: string; netPay: number }[]> {
  const rows = await prisma.payroll.findMany({
    where: { employeeId, status: { in: ['Published', 'Locked'] } },
    orderBy: { month: 'desc' },
    select: { month: true, netPay: true },
  });
  return rows.map((r) => ({ month: r.month, netPay: r.netPay.toNumber() }));
}

export async function loadMonthPayslipTargets(
  month: string,
  permitted: PermittedBranches,
): Promise<{ employeeId: string; name: string }[]> {
  const rows = await prisma.payroll.findMany({
    where: {
      month,
      status: { in: ['Published', 'Locked'] },
      ...viaEmployeeBranchScope(permitted),
    },
    orderBy: { employee: { firstName: 'asc' } },
    select: { employeeId: true, employee: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
  }));
}
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/payslip-history.integration.test.ts`:

```ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadEmployeePayslipHistory, loadMonthPayslipTargets } from '@/lib/payslip/history';

async function reset() {
  await prisma.payroll.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

async function makeEmp(branchId: string, firstName: string) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName,
      lastName: 'ทดสอบ',
      branchId,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}
async function makePayroll(employeeId: string, month: string, status: 'Draft' | 'Published' | 'Locked', net = 19000) {
  return prisma.payroll.create({
    data: { employeeId, month, incomeBase: new Prisma.Decimal(20000), netPay: new Prisma.Decimal(net), status },
  });
}

beforeEach(reset);
afterAll(async () => { await prisma.$disconnect(); });

describe('loadEmployeePayslipHistory', () => {
  it('returns Published/Locked months newest-first, excluding Draft', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await makeEmp(b.id, 'ก');
    await makePayroll(e.id, '2026-04', 'Locked', 18000);
    await makePayroll(e.id, '2026-06', 'Published', 19000);
    await makePayroll(e.id, '2026-05', 'Draft', 0); // excluded
    const hist = await loadEmployeePayslipHistory(e.id);
    expect(hist.map((h) => h.month)).toEqual(['2026-06', '2026-04']);
    expect(hist[0]).toEqual({ month: '2026-06', netPay: 19000 });
  });
});

describe('loadMonthPayslipTargets', () => {
  it('returns frozen-slip employees for a month, branch-scoped, excluding Draft', async () => {
    const hq = await prisma.branch.create({ data: { name: 'HQ' } });
    const other = await prisma.branch.create({ data: { name: 'Other' } });
    const e1 = await makeEmp(hq.id, 'ก');
    const e2 = await makeEmp(hq.id, 'ข');
    const e3 = await makeEmp(other.id, 'ค');
    await makePayroll(e1.id, '2026-06', 'Published');
    await makePayroll(e2.id, '2026-06', 'Draft'); // excluded (not frozen)
    await makePayroll(e3.id, '2026-06', 'Published'); // other branch
    // 'all' → both HQ + other frozen
    expect((await loadMonthPayslipTargets('2026-06', 'all')).map((t) => t.employeeId).sort()).toEqual([e1.id, e3.id].sort());
    // scoped to HQ → only e1
    expect((await loadMonthPayslipTargets('2026-06', [hq.id])).map((t) => t.employeeId)).toEqual([e1.id]);
  });
});
```

- [ ] **Step 3: Run + verify**

Run: `npm run test:integration -- payslip-history` (local test DB; `npm run db:test:deploy` / `supabase start` if needed). Then `npx tsc --noEmit`.
Expected: PASS. (If `Employee`/`Branch` need more required fields, mirror `tests/integration/reports.integration.test.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/payslip/history.ts tests/integration/payslip-history.integration.test.ts
git commit -m "feat(payslip): history loaders (per-employee + per-month targets)"
```

---

### Task 4: Zip entry-name builder

**Files:**
- Create: `src/lib/payslip/zip-name.ts`
- Test: `src/lib/payslip/zip-name.test.ts`

**Interfaces:**
- Produces: `payslipZipEntryName(name: string, month: string, seen: Set<string>): string` — a filesystem-safe `<name>_<month>.pdf`, de-duped against `seen` (mutates `seen`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/payslip/zip-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { payslipZipEntryName } from './zip-name';

describe('payslipZipEntryName', () => {
  it('builds <name>_<month>.pdf, sanitizing path/space chars', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('สมชาย ใจดี', '2026-06', seen)).toBe('สมชาย_ใจดี_2026-06.pdf');
  });
  it('strips slashes and control chars that would break a zip path', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('a/b\\c', '2026-06', seen)).toBe('a-b-c_2026-06.pdf');
  });
  it('de-dupes collisions with a numeric suffix', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06.pdf');
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06 (2).pdf');
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06 (3).pdf');
  });
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- src/lib/payslip/zip-name.test.ts`
Expected: FAIL — `Cannot find module './zip-name'`.

- [ ] **Step 3: Implement**

Create `src/lib/payslip/zip-name.ts`:

```ts
/** Filesystem-safe zip entry name `<name>_<month>.pdf`, de-duped against `seen`. */
export function payslipZipEntryName(name: string, month: string, seen: Set<string>): string {
  const safe = name
    .trim()
    .replace(/[/\\]+/g, '-') // path separators
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control chars from filenames
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/\s+/g, '_');
  const base = `${safe}_${month}`;
  let candidate = `${base}.pdf`;
  let n = 1;
  while (seen.has(candidate)) {
    n += 1;
    candidate = `${base} (${n}).pdf`;
  }
  seen.add(candidate);
  return candidate;
}
```

- [ ] **Step 4: Run green + commit**

Run: `npm test -- src/lib/payslip/zip-name.test.ts` → PASS.

```bash
git add src/lib/payslip/zip-name.ts src/lib/payslip/zip-name.test.ts
git commit -m "feat(payslip): zip entry-name builder (sanitize + de-dupe)"
```

---

### Task 5: LIFF "all my payslips" list

**Files:**
- Modify: `src/app/(liff)/liff/payslip/page.tsx`

- [ ] **Step 1: Add the list branch**

In `liff/payslip/page.tsx`, the page currently defaults an absent `?m=` to the current month (single slip). Change it so **absent `?m=` renders a list** of the employee's Published/Locked months, while a **present `?m=` keeps the current single-slip view unchanged**.

- Load the history for the list: alongside the existing `requireEmployee()`, when `params.m` is absent (or fails `MONTH_RE`), query:

```tsx
const months = await prisma.payroll.findMany({
  where: { employeeId: employee.id, status: { in: ['Published', 'Locked'] } },
  orderBy: { month: 'desc' },
  select: { month: true, netPay: true },
});
```

- Render a list using the page's existing primitives (`cardCls`, `formatMoney(value, locale)` from `@/lib/i18n/format`, the page-local `buildMonthLabel(locale, ym)`), each row a card with the month label + `formatMoney(row.netPay.toNumber(), locale)` + a **download** `<a href={`/liff/payslip/pdf?m=${row.month}`}>` styled like the existing download anchor (`page.tsx:100-107`), plus a "view" `<Link href={`/liff/payslip?m=${row.month}`}>` to open the single slip. Empty list → the existing empty-state card (`t('empty')`).
- Keep the entire existing single-slip render path for when `params.m` is a valid month (so LINE deep-links `?m=…` still work). Structure it as: `if (!params.m || !MONTH_RE.test(params.m)) { return <ListView/> } ` else the current view.

> Reuse the file's existing imports/helpers; do not import `@/lib/format` here (this page is locale-aware via `@/lib/i18n/format`). Match `max-w-md` + `space-y-4` layout.

- [ ] **Step 2: Verify + manual**

Run: `npx tsc --noEmit && npm run lint`
Manual (dev server, logged-in employee): `/liff/payslip` shows the month list with working download links; `/liff/payslip?m=YYYY-MM` still shows the single slip.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(liff)/liff/payslip/page.tsx"
git commit -m "feat(payslip): LIFF 'all my payslips' list on bare /liff/payslip"
```

---

### Task 6: Admin single-download route + config

**Files:**
- Create: `src/app/(admin)/admin/payroll/payslip-pdf/route.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `buildPayslipRenderClosure` (Task 2); `getOrRenderPayslipPdf`; `requirePermission`, `getPermittedBranches`, `canActOnEmployeeBranches`; `auditLog`; `prisma`.

- [ ] **Step 1: Create the route**

Create `src/app/(admin)/admin/payroll/payslip-pdf/route.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { buildPayslipRenderClosure } from '@/lib/payslip/render-closure';
import { getOrRenderPayslipPdf } from '@/lib/payslip/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const { user } = await requirePermission('payroll.read');
  const sp = req.nextUrl.searchParams;
  const month = sp.get('m') ?? '';
  const employeeId = sp.get('employeeId') ?? '';
  if (!MONTH_RE.test(month) || !UUID_RE.test(employeeId)) {
    return new NextResponse('Bad params', { status: 400 });
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp) return new NextResponse('Not found', { status: 404 });
  const permitted = await getPermittedBranches(user, 'payroll.read');
  if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rc = await buildPayslipRenderClosure(employeeId, month);
  if (!rc) return new NextResponse('Not found', { status: 404 });

  try {
    const { signedUrl, fromCache } = await getOrRenderPayslipPdf({ employeeId, month, render: rc.render });
    auditLog({
      actorId: user.id,
      action: 'payslip.download',
      entityType: 'Payroll',
      entityId: `${employeeId}:${month}`,
      metadata: { source: 'admin-ui', month, fromCache },
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('[admin payslip-pdf] failed', { employeeId, month, err });
    return new NextResponse('Could not generate payslip', { status: 500 });
  }
}
```

> Confirm `Employee.assignedBranchIds` exists (used by the edit page's scope check); if the field name differs, match it.

- [ ] **Step 2: Add the tracing entry + remove the stale one**

In `next.config.ts` `outputFileTracingIncludes`: **remove** the `'/admin/payroll/preview-pdf'` block entirely, and **add**:

```ts
  '/admin/payroll/payslip-pdf': [
    './src/lib/payslip/fonts/**',
    './node_modules/@sparticuz/chromium/bin/**',
    './node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
  ],
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (Manual PDF verification happens after Task 7 wires the link.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/payroll/payslip-pdf/route.ts" next.config.ts
git commit -m "feat(payslip): admin single-payslip PDF download route (+ config; drop stale entry)"
```

---

### Task 7: Admin employee payslip-history section

**Files:**
- Create: `src/app/(admin)/admin/employees/[id]/edit/payslip-history-section.tsx`
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `loadEmployeePayslipHistory` (Task 3); the route from Task 6; `canDo`; `monthLabelTh`, `formatTHB2`.

- [ ] **Step 1: Create the section component**

Create `payslip-history-section.tsx` — a card (mirroring `EntitlementsSection`'s markup) listing the months with a per-row download link:

```tsx
import Link from 'next/link';
import { formatTHB2, monthLabelTh } from '@/lib/format';

export function PayslipHistorySection({
  employeeId,
  history,
}: {
  employeeId: string;
  history: { month: string; netPay: number }[];
}) {
  return (
    <section className="surface p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink-1">สลิปเงินเดือน</h2>
      {history.length === 0 ? (
        <p className="text-sm text-ink-4">ยังไม่มีสลิปที่เผยแพร่</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {history.map((h) => (
            <li key={h.month} className="flex items-center justify-between py-2">
              <span className="text-sm text-ink-2">{monthLabelTh(h.month)}</span>
              <span className="flex items-center gap-4">
                <span className="tabular text-sm text-ink-3">{formatTHB2(h.netPay)}</span>
                <Link
                  href={`/admin/payroll/payslip-pdf?m=${h.month}&employeeId=${employeeId}`}
                  className="text-sm font-medium text-primary-700 hover:text-primary-800"
                  download
                >
                  ดาวน์โหลด PDF
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the edit page**

In `employees/[id]/edit/page.tsx`: after the existing gates, compute `const mayPayroll = await canDo(user, 'payroll.read');` (import `canDo` from `@/lib/auth/check-permission`) and, when true, load `const payslipHistory = await loadEmployeePayslipHistory(id);`. Add `<PayslipHistorySection employeeId={id} history={payslipHistory} />` into the `belowForm` stack (alongside `EntitlementsSection`), rendered only when `mayPayroll`.

> Match the real `surface`/`text-ink-*`/`tabular` classes to the sibling section components; adjust if they differ.

- [ ] **Step 3: Verify + manual**

Run: `npx tsc --noEmit && npm run lint`
Manual: open an employee with published payroll → the "สลิปเงินเดือน" section lists months; clicking **ดาวน์โหลด PDF** downloads the slip (302 → signed URL). Confirm an admin lacking `payroll.read` doesn't see the section.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/payslip-history-section.tsx" "src/app/(admin)/admin/employees/[id]/edit/page.tsx"
git commit -m "feat(payslip): admin per-employee payslip history + download"
```

---

### Task 8: Admin bulk month zip route

**Files:**
- Create: `src/app/(admin)/admin/payroll/payslips-zip/route.ts`
- Modify: `next.config.ts`, `package.json` (add `jszip`)

**Interfaces:**
- Consumes: `loadMonthPayslipTargets` (Task 3), `buildPayslipRenderClosure` (Task 2), `getPayslipPdfBytes` (Task 1), `payslipZipEntryName` (Task 4); `requirePermission`, `getPermittedBranches`; `auditLog`; `jszip`.

- [ ] **Step 1: Add jszip**

Run: `pnpm add jszip`
Expected: `jszip` added to `dependencies` (ships its own TS types).

- [ ] **Step 2: Create the route**

Create `src/app/(admin)/admin/payroll/payslips-zip/route.ts`:

```ts
import JSZip from 'jszip';
import { type NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/audit/log';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { loadMonthPayslipTargets } from '@/lib/payslip/history';
import { buildPayslipRenderClosure } from '@/lib/payslip/render-closure';
import { getPayslipPdfBytes } from '@/lib/payslip/storage';
import { payslipZipEntryName } from '@/lib/payslip/zip-name';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest): Promise<Response> {
  const { user } = await requirePermission('payroll.read');
  const month = req.nextUrl.searchParams.get('m') ?? '';
  if (!MONTH_RE.test(month)) return new NextResponse('Bad month', { status: 400 });

  const permitted = await getPermittedBranches(user, 'payroll.read');
  const targets = await loadMonthPayslipTargets(month, permitted);
  if (targets.length === 0) return new NextResponse('No payslips', { status: 404 });

  try {
    const zip = new JSZip();
    const seen = new Set<string>();
    let count = 0;
    for (const target of targets) {
      const rc = await buildPayslipRenderClosure(target.employeeId, month);
      if (!rc) continue; // frozen slip vanished between select and render
      const bytes = await getPayslipPdfBytes({ employeeId: target.employeeId, month, render: rc.render });
      zip.file(payslipZipEntryName(target.name, month, seen), bytes);
      count += 1;
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    auditLog({
      actorId: user.id,
      action: 'payslip.download',
      entityType: 'Payroll',
      entityId: `bulk:${month}`,
      metadata: { source: 'admin-ui-bulk', month, count },
    });

    const filename = `สลิปเงินเดือน_${month}.zip`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="payslips-${month}.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[admin payslips-zip] failed', { month, err });
    return new NextResponse('Could not build zip', { status: 500 });
  }
}
```

- [ ] **Step 3: Add the tracing entry**

In `next.config.ts` `outputFileTracingIncludes`, add (the zip route renders PDFs on cold misses via the shared closure):

```ts
  '/admin/payroll/payslips-zip': [
    './src/lib/payslip/fonts/**',
    './node_modules/@sparticuz/chromium/bin/**',
    './node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
  ],
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (Manual zip verification after Task 9 adds the button; or hit the URL directly logged-in as admin — expect a `.zip` with one PDF per frozen slip.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/payroll/payslips-zip/route.ts" next.config.ts package.json pnpm-lock.yaml
git commit -m "feat(payslip): admin bulk month zip export (+ jszip, config)"
```

---

### Task 9: Bulk-download button on the payroll page

**Files:**
- Modify: `src/app/(admin)/admin/payroll/page.tsx`

- [ ] **Step 1: Add the button**

In `admin/payroll/page.tsx`, in the run-actions region (`<div className="mb-6 flex flex-wrap items-center gap-3">`), add a raw `<a download>` styled like the secondary buttons, shown only when the month has ≥1 frozen slip (`statusCounts.Published + statusCounts.Locked > 0`):

```tsx
{statusCounts.Published + statusCounts.Locked > 0 && (
  <a
    href={`/admin/payroll/payslips-zip?m=${month}`}
    download
    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
  >
    ดาวน์โหลดสลิปทั้งหมด (.zip)
  </a>
)}
```

> Match the exact button classes to the sibling `RunActionForm`/`Button variant="secondary"` styling on this page. The zip route reads only `m` (branch/department filters on the page are not applied to the zip in v1 — it exports the whole month within the caller's permitted branches; note this in the plan if the user later wants filter-aware zips).

- [ ] **Step 2: Verify + manual**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green. Manual: on `/admin/payroll?m=YYYY-MM` with published slips, the "ดาวน์โหลดสลิปทั้งหมด (.zip)" button downloads a zip containing one PDF per employee.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/payroll/page.tsx"
git commit -m "feat(payslip): bulk zip download button on payroll page"
```

---

## Self-Review

**Spec coverage** (against `2026-07-07-payslip-archive-design.md`):
- Bytes helper `getPayslipPdfBytes` → Task 1. ✅
- Shared render closure (avoids duplicating the LIFF closure) → Task 2. ✅
- History loaders (`loadEmployeePayslipHistory`, `loadMonthPayslipTargets`) → Task 3. ✅
- Zip entry-name builder → Task 4. ✅
- Employee LIFF "all my payslips" list → Task 5. ✅
- Admin single-download route (gated, branch-scoped, employee locale, audit) → Task 6. ✅
- Admin per-employee history section → Task 7. ✅
- Admin bulk month zip (jszip, cold-path render, audit+count) → Task 8. ✅
- Bulk button on payroll page → Task 9. ✅
- Chromium config: two new entries + remove stale `preview-pdf` → Tasks 6, 8. ✅
- Published/Locked only; `payroll.read`+scope; employee-locale render → enforced across tasks. ✅
- Non-goals (contracts, LIFF bulk, regeneration UI, filter-aware zip) → not implemented; filter-aware zip flagged in Task 9. ✅

**Deviations noted:** the design said the per-employee history lives on "the employee detail page" — the detail page IS `[id]/edit` (no separate detail route), so the section is added to its `belowForm` slot (Task 7). The bulk zip in v1 exports the whole month within the caller's branches (branch/department page filters not applied) — flagged in Task 9.

**Placeholder scan:** no TBD/TODO steps. The one real-world unknowns (`Employee.assignedBranchIds` field name, sibling section CSS classes, exact `Button` styling) are called out with "confirm/match against the real file" notes.

**Type consistency:** `buildPayslipRenderClosure(employeeId, month) → { render } | null` (Task 2) consumed by Tasks 6 & 8. `getPayslipPdfBytes({employeeId, month, render})` (Task 1) consumed by Task 8. `loadEmployeePayslipHistory → {month, netPay}[]` (Task 3) consumed by Task 7. `loadMonthPayslipTargets → {employeeId, name}[]` (Task 3) consumed by Task 8. `payslipZipEntryName(name, month, seen)` (Task 4) consumed by Task 8. Route path `/admin/payroll/payslip-pdf` (Task 6) matches the link in Task 7 and the config entry.
