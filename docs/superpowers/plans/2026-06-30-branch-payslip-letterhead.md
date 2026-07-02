# Per-branch payslip letterhead + localized branch name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each branch optionally set its own payslip letterhead (company name native + English, logo) and an English branch name shown to non-Thai employees — falling back to today's hardcoded Koolman default when unset.

**Architecture:** Four nullable columns on `Branch`. Two small resolver units — `localizedBranchName` (pure) and `resolveLetterhead` (the only image I/O). The payslip document carries both branch names + the raw letterhead fields (logo *key*, not bytes); the three render call-sites resolve the letterhead and pass `companyEn`/`companyNative`/`logoSvg` into a now-parameterized `buildPayslipHtml`. Admin sets it on the branch form via a logo-upload field mirroring the employee photo pattern.

**Tech Stack:** Next.js 16 App Router, Prisma 6 + Postgres, Supabase Storage (`attendance-photos` bucket), next-intl, Vitest, Biome.

## Global Constraints

- **Locale rule:** "non-Thai" = `locale !== 'th'`. Localized branch name = `locale === 'th' ? name : (nameEn || name)`. Copy this exact expression.
- **Letterhead defaults (verbatim):** `COMPANY_EN = 'Koolman Co., Ltd.'`, `COMPANY_NATIVE = 'บริษัท คูลแมน จำกัด'`, logo fallback = `payslipLogoSvg()`. A null field uses the default.
- **Logo:** PNG, square/round mark, ≤256px, bucket `attendance-photos`, key `{adminAuthUserId}/branch-logos/{branchId|new-rand}.png`, `upsert: true`.
- **No retroactive rewrite:** never invalidate or re-render already-cached published PDFs. Only new renders pick up changes.
- **resolveLetterhead is stateless** (fresh download per call); de-duplication for publish-warming happens in `warm.ts`, keyed by the letterhead fields, to avoid serving a stale logo after an admin replaces it (the key is stable under `upsert`).
- **Commits:** use `--no-verify` (the pre-commit `lint-staged` hook isn't installed in this worktree; run `npx biome check .` manually instead).
- **Permission gate:** branch mutations already run `requirePermission('settings.branch.manage')` — do not change that.

---

### Task 1: Schema + migration for the 4 new Branch columns

**Files:**
- Modify: `prisma/schema.prisma` (Branch model, after `name`)
- Create: `prisma/migrations/0035_branch_payslip_letterhead/migration.sql`

**Interfaces:**
- Produces: `Branch.payslipNameEn`, `Branch.payslipNameNative`, `Branch.payslipLogoKey`, `Branch.nameEn` — all `String?`.

- [ ] **Step 1: Add the columns to the Prisma schema**

In `prisma/schema.prisma`, inside `model Branch`, immediately after the `name String @unique` line, add:

```prisma
  /// English variant of the branch's own location name (e.g. "Chiang Mai").
  /// Null → fall back to `name`. Shown to non-Thai employees.
  nameEn            String?
  /// Payslip letterhead overrides. Null → hardcoded Koolman default.
  payslipNameEn     String?   // English company name, e.g. "Koolman Co., Ltd."
  payslipNameNative String?   // Native company name, e.g. "บริษัท คูลแมน จำกัด"
  payslipLogoKey    String?   // storage key in `attendance-photos`
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/0035_branch_payslip_letterhead/migration.sql`:

```sql
-- Per-branch payslip letterhead + localized branch name (all optional → null = default)
ALTER TABLE "Branch" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipNameEn" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipNameNative" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipLogoKey" TEXT;
```

- [ ] **Step 3: Apply the migration to the local DB and regenerate the client**

Run: `pnpm prisma migrate deploy && pnpm prisma generate`
Expected: "1 migration applied" (0035…) and "Generated Prisma Client". If the local DB isn't running, start it first per the project's local-stack steps.

- [ ] **Step 4: Verify the types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (the new fields are now on the generated `Branch` type).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0035_branch_payslip_letterhead
git commit --no-verify -m "feat(branch): add payslip letterhead + nameEn columns"
```

---

### Task 2: `localizedBranchName` pure helper

**Files:**
- Create: `src/lib/branch/localized-name.ts`
- Test: `src/lib/branch/localized-name.test.ts`

**Interfaces:**
- Produces: `localizedBranchName(branch: { name: string; nameEn: string | null }, locale: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/branch/localized-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localizedBranchName } from './localized-name';

describe('localizedBranchName', () => {
  const branch = { name: 'เชียงใหม่', nameEn: 'Chiang Mai' };

  it('returns the native name for the Thai locale', () => {
    expect(localizedBranchName(branch, 'th')).toBe('เชียงใหม่');
  });

  it('returns the English name for a non-Thai locale', () => {
    expect(localizedBranchName(branch, 'en')).toBe('Chiang Mai');
    expect(localizedBranchName(branch, 'my')).toBe('Chiang Mai');
  });

  it('falls back to the native name when nameEn is null, even for non-Thai', () => {
    expect(localizedBranchName({ name: 'เชียงใหม่', nameEn: null }, 'en')).toBe('เชียงใหม่');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/branch/localized-name.test.ts`
Expected: FAIL — cannot find module `./localized-name`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/branch/localized-name.ts`:

```ts
/**
 * The branch label to show an employee in their own locale.
 *
 * Thai employees (and any branch without an English name) see the native
 * `name`; non-Thai employees see `nameEn` when it's set. Used by the payslip
 * สาขา field and the LIFF profile / check-in surfaces.
 */
export function localizedBranchName(
  branch: { name: string; nameEn: string | null },
  locale: string,
): string {
  return locale === 'th' ? branch.name : branch.nameEn || branch.name;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/branch/localized-name.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/branch/localized-name.ts src/lib/branch/localized-name.test.ts
git commit --no-verify -m "feat(branch): localizedBranchName helper"
```

---

### Task 3: Carry both branch names + raw letterhead through the payslip document

**Files:**
- Modify: `src/lib/payslip/types.ts` (PayslipDocument.meta)
- Modify: `src/lib/payslip/document.ts` (NormalizedPayslipInput.meta + getPayslipDocument)
- Modify: `src/lib/payslip/preview.ts` (buildPreviewPayslipDocument)
- Test: `src/lib/payslip/document.test.ts` (extend)

**Interfaces:**
- Consumes: `assemblePayslipDocument` returns `{ meta, ... }` passthrough (verified).
- Produces: `PayslipDocument.meta.branchEn: string | null` and `PayslipDocument.meta.letterhead: { payslipNameEn: string | null; payslipNameNative: string | null; payslipLogoKey: string | null }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payslip/document.test.ts` (it already imports `assemblePayslipDocument` / a `NormalizedPayslipInput` builder — reuse the existing test's input factory; if the file builds an input inline, mirror that shape and add the new meta fields):

```ts
import { describe, expect, it } from 'vitest';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';

describe('assemblePayslipDocument — letterhead passthrough', () => {
  const baseInput: NormalizedPayslipInput = {
    meta: {
      employeeName: 'Test User',
      employeeId: 'EMP-1',
      branch: 'เชียงใหม่',
      branchEn: 'Chiang Mai',
      letterhead: {
        payslipNameEn: 'Acme Co., Ltd.',
        payslipNameNative: 'บริษัท แอคมี จำกัด',
        payslipLogoKey: 'admin-1/branch-logos/b1.png',
      },
      department: null,
      payType: 'Monthly',
      month: '2026-06',
    },
    buckets: {
      incomeBase: 10000, incomeOther: 0, deductSso: 0, deductAdvance: 0,
      deductAttendance: 0, deductLeave: 0, deductDebt: 0, deductOther: 0, netPay: 10000,
    },
    incomeAdjustments: [],
    deductAdjustments: [],
    advanceCount: 0,
    attendance: { absent: 0, late: 0 },
    leaveOverMinutesTotal: 0,
    rateInputs: {
      ssoRate: 0.05, ssoSalaryCap: 15000, salaryType: 'Monthly',
      baseSalary: 10000, workingDaysPerMonth: 26, standardDayMinutes: 480,
    },
  };

  it('passes branchEn and letterhead through to the document meta', () => {
    const doc = assemblePayslipDocument(baseInput);
    expect(doc.meta.branchEn).toBe('Chiang Mai');
    expect(doc.meta.letterhead.payslipNameEn).toBe('Acme Co., Ltd.');
    expect(doc.meta.letterhead.payslipLogoKey).toBe('admin-1/branch-logos/b1.png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/payslip/document.test.ts`
Expected: FAIL — `branchEn`/`letterhead` missing on the `NormalizedPayslipInput.meta` type (TS error) and/or undefined at runtime.

- [ ] **Step 3: Extend the types**

In `src/lib/payslip/types.ts`, change `PayslipDocument.meta` to:

```ts
  meta: {
    employeeName: string;
    employeeId: string;
    branch: string;
    branchEn: string | null;
    letterhead: {
      payslipNameEn: string | null;
      payslipNameNative: string | null;
      payslipLogoKey: string | null;
    };
    department: string | null;
    payType: 'Monthly' | 'Daily' | 'Hourly';
    month: string;
  };
```

In `src/lib/payslip/document.ts`, change `NormalizedPayslipInput.meta` identically (add `branchEn` and `letterhead` with the same shape).

- [ ] **Step 4: Populate the fields in `getPayslipDocument`**

In `src/lib/payslip/document.ts`, in the `prisma.employee.findUniqueOrThrow` `select`, replace `branch: { select: { name: true } },` with:

```ts
        branch: {
          select: {
            name: true,
            nameEn: true,
            payslipNameEn: true,
            payslipNameNative: true,
            payslipLogoKey: true,
          },
        },
```

Then in the `input.meta` object literal (where `branch: employee.branch.name,` is set), replace that line with:

```ts
      branch: employee.branch.name,
      branchEn: employee.branch.nameEn,
      letterhead: {
        payslipNameEn: employee.branch.payslipNameEn,
        payslipNameNative: employee.branch.payslipNameNative,
        payslipLogoKey: employee.branch.payslipLogoKey,
      },
```

- [ ] **Step 5: Populate the fields in `buildPreviewPayslipDocument`**

In `src/lib/payslip/preview.ts`, apply the identical two edits: the `branch` `select` (add `nameEn`, `payslipNameEn`, `payslipNameNative`, `payslipLogoKey`) and the `input.meta` (add `branchEn` + `letterhead`), exactly as in Step 4.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/lib/payslip/document.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: document test PASS; tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/payslip/types.ts src/lib/payslip/document.ts src/lib/payslip/preview.ts src/lib/payslip/document.test.ts
git commit --no-verify -m "feat(payslip): carry branchEn + raw letterhead through the document"
```

---

### Task 4: Parameterize `buildPayslipHtml` (company name opts + branch-field localization)

**Files:**
- Modify: `src/lib/payslip/render-html.ts`
- Test: `src/lib/payslip/render-html.test.ts` (extend)

**Interfaces:**
- Consumes: `PayslipDocument.meta.branchEn` (Task 3).
- Produces: `BuildPayslipHtmlOpts` gains `companyEn: string` and `companyNative: string`. `COMPANY_EN` / `COMPANY_NATIVE` are exported from `render-html.ts` for reuse.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payslip/render-html.test.ts` (reuse the existing `doc` + `opts` fixtures at the top of the file; they already pass `t/tEn/money/...`):

```ts
describe('buildPayslipHtml — per-branch letterhead + branch localization', () => {
  it('renders the companyEn / companyNative opts in the header', () => {
    const html = buildPayslipHtml(
      { ...doc, meta: { ...doc.meta, branchEn: null, letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null } } },
      { ...opts, locale: 'th', companyEn: 'Acme Co., Ltd.', companyNative: 'บริษัท แอคมี จำกัด' },
    );
    expect(html).toContain('Acme Co., Ltd.');
    expect(html).toContain('บริษัท แอคมี จำกัด');
  });

  it('shows the English branch name in the สาขา field for a non-Thai locale', () => {
    const meta = { ...doc.meta, branch: 'เชียงใหม่', branchEn: 'Chiang Mai', letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null } };
    const en = buildPayslipHtml({ ...doc, meta }, { ...opts, locale: 'en', companyEn: 'X', companyNative: 'Y' });
    expect(en).toContain('Chiang Mai');
    const th = buildPayslipHtml({ ...doc, meta }, { ...opts, locale: 'th', companyEn: 'X', companyNative: 'Y' });
    expect(th).toContain('เชียงใหม่');
  });
});
```

Note: the existing `opts` fixture must gain `companyEn`/`companyNative` so the other tests still compile — add `companyEn: 'Koolman Co., Ltd.'` and `companyNative: 'บริษัท คูลแมน จำกัด'` to the shared `opts` object at the top of the file, and `branchEn: null` + `letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null }` to the shared `doc.meta` fixture.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/payslip/render-html.test.ts`
Expected: FAIL — `companyEn`/`companyNative` not in `BuildPayslipHtmlOpts` (TS) and not rendered.

- [ ] **Step 3: Add the opts and export the defaults**

In `src/lib/payslip/render-html.ts`, change the two constant declarations to be exported (so the resolver can reuse them):

```ts
export const COMPANY_EN = 'Koolman Co., Ltd.';
export const COMPANY_NATIVE = 'บริษัท คูลแมน จำกัด';
```

In `interface BuildPayslipHtmlOpts`, add (next to `logoSvg`):

```ts
  /** Company name shown in the header (English line). Default: COMPANY_EN. */
  companyEn: string;
  /** Company name shown in the header (native line). Default: COMPANY_NATIVE. */
  companyNative: string;
```

- [ ] **Step 4: Use the opts in the header + localize the branch field**

In `buildPayslipHtml`, add `companyEn` and `companyNative` to the destructured `opts` (the `const { locale, t, tEn, money, fontFace, logoSvg, periodLabel, generatedAt } = opts;` line). After `const isEn = locale === 'en';`, add:

```ts
  // Non-Thai employees see the English branch name in the สาขา field.
  const branchLabel = locale === 'th' ? doc.meta.branch : doc.meta.branchEn || doc.meta.branch;
```

Replace the header lines:

```ts
          <div class="co-name">${COMPANY_EN}</div>
          <div class="co-sub">${isEn ? '' : COMPANY_NATIVE}</div>
```

with:

```ts
          <div class="co-name">${companyEn}</div>
          <div class="co-sub">${isEn ? '' : companyNative}</div>
```

Replace the branch info row (currently `...doc.meta.branch)}`):

```ts
      ${infoRow(t('profile.readonly.branch'), tEn('profile.readonly.branch'), doc.meta.branch)}
```

with:

```ts
      ${infoRow(t('profile.readonly.branch'), tEn('profile.readonly.branch'), branchLabel)}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/payslip/render-html.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all render-html tests PASS; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payslip/render-html.ts src/lib/payslip/render-html.test.ts
git commit --no-verify -m "feat(payslip): parameterize header company name + localize branch field"
```

---

### Task 5: `resolveLetterhead` (defaults + logo → base64 img)

**Files:**
- Modify: `src/lib/payslip/letterhead.ts` (add the resolver)
- Test: `src/lib/payslip/letterhead.test.ts` (extend)

**Interfaces:**
- Consumes: `COMPANY_EN`, `COMPANY_NATIVE` from `render-html.ts`; `payslipLogoSvg()` (same file); `getSupabaseAdminClient` from `@/lib/supabase/admin`.
- Produces: `resolveLetterhead(input: { payslipNameEn: string | null; payslipNameNative: string | null; payslipLogoKey: string | null }): Promise<{ companyEn: string; companyNative: string; logoHtml: string }>`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payslip/letterhead.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const download = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ storage: { from: () => ({ download }) } }),
}));

import { resolveLetterhead } from './letterhead';

describe('resolveLetterhead', () => {
  it('uses Koolman defaults + the SVG logo when all fields are null', async () => {
    const r = await resolveLetterhead({ payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null });
    expect(r.companyEn).toBe('Koolman Co., Ltd.');
    expect(r.companyNative).toBe('บริษัท คูลแมน จำกัด');
    expect(r.logoHtml).toContain('<svg');
    expect(download).not.toHaveBeenCalled();
  });

  it('overrides names and embeds the logo as a base64 img when set', async () => {
    download.mockResolvedValueOnce({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    const r = await resolveLetterhead({
      payslipNameEn: 'Acme Co., Ltd.',
      payslipNameNative: 'บริษัท แอคมี จำกัด',
      payslipLogoKey: 'admin-1/branch-logos/b1.png',
    });
    expect(r.companyEn).toBe('Acme Co., Ltd.');
    expect(r.logoHtml).toContain('data:image/png;base64,');
    expect(r.logoHtml).toContain('<img');
  });

  it('falls back to the SVG logo when the download fails', async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const r = await resolveLetterhead({ payslipNameEn: null, payslipNameNative: null, payslipLogoKey: 'missing.png' });
    expect(r.logoHtml).toContain('<svg');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/payslip/letterhead.test.ts`
Expected: FAIL — `resolveLetterhead` is not exported.

- [ ] **Step 3: Implement `resolveLetterhead`**

In `src/lib/payslip/letterhead.ts`, add these imports at the top (keep the existing ones):

```ts
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { COMPANY_EN, COMPANY_NATIVE } from './render-html';
```

Then append:

```ts
export type LetterheadInput = {
  payslipNameEn: string | null;
  payslipNameNative: string | null;
  payslipLogoKey: string | null;
};

export type ResolvedLetterhead = {
  companyEn: string;
  companyNative: string;
  logoHtml: string;
};

/**
 * Turn a branch's raw letterhead fields into render-ready header pieces:
 * names fall back to the Koolman defaults; the logo key is downloaded
 * (service-role) and embedded as a self-contained base64 <img>, or the
 * inline SVG when there's no key / the download fails.
 *
 * Stateless on purpose — the logo key is stable under `upsert`, so a
 * process-level cache would serve a stale logo after a replace. Callers
 * that render many slips at once (publish-warming) de-dupe per branch.
 */
export async function resolveLetterhead(input: LetterheadInput): Promise<ResolvedLetterhead> {
  const companyEn = input.payslipNameEn ?? COMPANY_EN;
  const companyNative = input.payslipNameNative ?? COMPANY_NATIVE;

  if (!input.payslipLogoKey) {
    return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .storage.from('attendance-photos')
      .download(input.payslipLogoKey);
    if (error || !data) return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
    const b64 = Buffer.from(await data.arrayBuffer()).toString('base64');
    const logoHtml = `<img class="logo" width="48" height="48" alt="" src="data:image/png;base64,${b64}">`;
    return { companyEn, companyNative, logoHtml };
  } catch (err) {
    console.error('[letterhead] logo download failed', {
      key: input.payslipLogoKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { companyEn, companyNative, logoHtml: payslipLogoSvg() };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/payslip/letterhead.test.ts`
Expected: PASS (existing letterhead tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payslip/letterhead.ts src/lib/payslip/letterhead.test.ts
git commit --no-verify -m "feat(payslip): resolveLetterhead — defaults + base64 logo"
```

---

### Task 6: Wire the 3 render call-sites to `resolveLetterhead`

**Files:**
- Modify: `src/app/(liff)/liff/payslip/pdf/route.ts`
- Modify: `src/app/(admin)/admin/payroll/preview-html/route.ts`
- Modify: `src/lib/payslip/warm.ts`

**Interfaces:**
- Consumes: `resolveLetterhead` (Task 5); `doc.meta.letterhead` (Task 3); `buildPayslipHtml` `companyEn`/`companyNative` opts (Task 4).

- [ ] **Step 1: Wire the LIFF PDF route**

In `src/app/(liff)/liff/payslip/pdf/route.ts`:
- Add to imports: `import { payslipLogoSvg, payslipPeriodLabel, resolveLetterhead } from '@/lib/payslip/letterhead';` (merge with the existing letterhead import; `payslipLogoSvg` may now be unused — remove it from the import if so).
- After `const doc = await getPayslipDocument(...)` and the `if (!doc) ...` guard, add:

```ts
    const letterhead = await resolveLetterhead(doc.meta.letterhead);
```

- In the `buildPayslipHtml(doc, { ... })` opts object, replace `logoSvg: payslipLogoSvg(),` with:

```ts
            logoSvg: letterhead.logoHtml,
            companyEn: letterhead.companyEn,
            companyNative: letterhead.companyNative,
```

- [ ] **Step 2: Wire the HTML preview route**

In `src/app/(admin)/admin/payroll/preview-html/route.ts`, apply the same three changes: import `resolveLetterhead` from `@/lib/payslip/letterhead`, compute `const letterhead = await resolveLetterhead(doc.meta.letterhead);` after the `if (!doc)` guard, and in the `buildPayslipHtml` opts replace `logoSvg: payslipLogoSvg(),` with the three lines (`logoSvg: letterhead.logoHtml,` `companyEn: letterhead.companyEn,` `companyNative: letterhead.companyNative,`). Drop the now-unused `payslipLogoSvg` import.

- [ ] **Step 3: Wire publish-warming (with per-branch de-dup)**

In `src/lib/payslip/warm.ts`:
- Add import: `import { resolveLetterhead, type ResolvedLetterhead } from './letterhead';` (and remove `payslipLogoSvg` from the existing letterhead import if present).
- Inside `warmPublishedPayslips`, before the `for (const target of args.targets)` loop, add a per-run cache:

```ts
  const letterheadCache = new Map<string, Promise<ResolvedLetterhead>>();
  const letterheadFor = (lh: import('./types').PayslipDocument['meta']['letterhead']) => {
    const cacheKey = JSON.stringify(lh);
    let p = letterheadCache.get(cacheKey);
    if (!p) {
      p = resolveLetterhead(lh);
      letterheadCache.set(cacheKey, p);
    }
    return p;
  };
```

- Inside the loop, after `const doc = await getPayslipDocument(...)` and its `if (!doc) continue;`, add `const letterhead = await letterheadFor(doc.meta.letterhead);`.
- In the `buildPayslipHtml(doc, { ... })` opts, replace `logoSvg: payslipLogoSvg(),` with the three lines (`logoSvg: letterhead.logoHtml,` `companyEn: letterhead.companyEn,` `companyNative: letterhead.companyNative,`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (all three call-sites now satisfy the required `companyEn`/`companyNative` opts).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(liff)/liff/payslip/pdf/route.ts" "src/app/(admin)/admin/payroll/preview-html/route.ts" src/lib/payslip/warm.ts
git commit --no-verify -m "feat(payslip): resolve per-branch letterhead at all render call-sites"
```

---

### Task 7: Logo upload helpers (`compressToPng` + `uploadBranchLogo`)

**Files:**
- Modify: `src/lib/storage/upload-selfie.ts`

**Interfaces:**
- Consumes: existing `canvasToBlob` (private in this file) and the `SelfieUploadResult` type.
- Produces: `compressToPng(file: File): Promise<Blob>` and `uploadBranchLogo(supabase: SupabaseClient, blob: Blob, adminAuthUserId: string, branchId: string | null): Promise<SelfieUploadResult>`.

Note: no unit test — these touch the browser `createImageBitmap`/`OffscreenCanvas`/Supabase upload, which Vitest's node env can't exercise. Verified by typecheck here and manually in Task 9. Keep them tiny and mirror the proven `compressToJpeg` / `uploadEmployeePhoto`.

- [ ] **Step 1: Add `compressToPng`**

In `src/lib/storage/upload-selfie.ts`, after the `compressToJpeg` function, add:

```ts
const LOGO_MAX_DIMENSION = 256; // logos are small; a 256px square is crisp at 48px

/**
 * Read a logo File, downscale to ≤256px (longest edge), encode as PNG so a
 * round/transparent mark stays crisp and keeps its alpha. Logos are tiny, so
 * unlike compressToJpeg there is no quality-step loop.
 */
export async function compressToPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw { kind: 'decode-failed', message: 'Browser failed to decode the image' };
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > LOGO_MAX_DIMENSION ? LOGO_MAX_DIMENSION / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw { kind: 'decode-failed', message: 'Canvas 2D context unavailable' };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvasToBlob(canvas, 'image/png', 1);
}
```

- [ ] **Step 2: Add `uploadBranchLogo`**

After `uploadEmployeePhoto` in the same file, add:

```ts
/**
 * Upload a compressed branch logo to
 * `{adminAuthUserId}/branch-logos/{branchId|new-rand}.png`.
 *
 * Same admin-uploads-to-own-folder RLS as uploadEmployeePhoto. Keyed by
 * branchId with upsert:true so re-uploads replace in place; the create form
 * has no id yet, so it uses a random suffix and the server action persists
 * whatever key it receives.
 */
export async function uploadBranchLogo(
  supabase: SupabaseClient,
  blob: Blob,
  adminAuthUserId: string,
  branchId: string | null,
): Promise<SelfieUploadResult> {
  const suffix = branchId ?? `new-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${adminAuthUserId}/branch-logos/${suffix}.png`;
  if (blob.size > MAX_BYTES) {
    throw { kind: 'too-large-after-compress', sizeBytes: blob.size };
  }
  const { error } = await supabase.storage.from('attendance-photos').upload(key, blob, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) {
    throw { kind: 'upload-failed', message: error.message };
  }
  return { key, sizeBytes: blob.size };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage/upload-selfie.ts
git commit --no-verify -m "feat(storage): compressToPng + uploadBranchLogo helpers"
```

---

### Task 8: `BranchLogoField` upload component

**Files:**
- Create: `src/app/(admin)/admin/settings/branches/branch-logo-field.tsx`

**Interfaces:**
- Consumes: `compressToPng`, `uploadBranchLogo` (Task 7); `createClient` from `@/lib/supabase/browser`.
- Produces: `<BranchLogoField branchId={string | null} initialKey={string | null} initialUrl={string | null} />` rendering a hidden `name="payslipLogoKey"` input.

Note: client component mirroring `PhotoField`. No unit test (browser canvas/upload). Verified by typecheck + manual run in Task 9.

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/settings/branches/branch-logo-field.tsx`:

```tsx
'use client';

/**
 * Branch logo field — preview + upload + remove. Lives inside the branch
 * <form>; compresses the picked image to PNG, uploads via the admin's browser
 * Supabase session, and writes the storage key into a hidden `payslipLogoKey`
 * input the server action persists. Mirrors the employee PhotoField.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { compressToPng, uploadBranchLogo } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type Props = {
  branchId: string | null;
  initialKey: string | null;
  initialUrl: string | null;
};

function errMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'อัปโหลดโลโก้ไม่สำเร็จ';
}

export function BranchLogoField({ branchId, initialKey, initialUrl }: Props) {
  const [key, setKey] = useState<string>(initialKey ?? '');
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        throw { kind: 'upload-failed', message: 'ไม่พบเซสชันผู้ดูแล กรุณาเข้าสู่ระบบใหม่' };
      }
      const blob = await compressToPng(file);
      const { key: newKey } = await uploadBranchLogo(supabase, blob, authData.user.id, branchId);
      setKey(newKey);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onRemove() {
    setKey('');
    setPreview(null);
    setError(null);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="payslipLogoKey" value={key} />
      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-100 text-ink-3">
          {preview ? (
            // biome-ignore lint/performance/noImgElement: client preview is an object-URL / signed URL next/image can't optimize
            <img src={preview} alt="โลโก้สาขา" className="size-full object-contain" />
          ) : (
            <span className="text-xs">ไม่มีโลโก้</span>
          )}
        </div>
        <div className="space-y-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50">
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => void onPick(e)}
              disabled={busy}
            />
            {busy ? 'กำลังอัปโหลด...' : preview ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
          </label>
          {preview && (
            <Button type="button" variant="secondary" onClick={onRemove} disabled={busy}>
              ลบโลโก้
            </Button>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/settings/branches/branch-logo-field.tsx"
git commit --no-verify -m "feat(branch): BranchLogoField upload component"
```

---

### Task 9: Branch form + actions + edit/new pages for the new fields

**Files:**
- Modify: `src/app/(admin)/admin/settings/branches/branch-form.tsx`
- Modify: `src/app/(admin)/admin/settings/branches/actions.ts`
- Modify: `src/app/(admin)/admin/settings/branches/[id]/edit/page.tsx`
- Modify: `src/app/(admin)/admin/settings/branches/new/page.tsx`

**Interfaces:**
- Consumes: `BranchLogoField` (Task 8); `resolveStoredImageUrl` from `@/lib/storage/signed-urls`.
- Produces: form posts `nameEn`, `payslipNameEn`, `payslipNameNative`, `payslipLogoKey`; actions persist them.

- [ ] **Step 1: Extend the form's `Initial` type + render the fields**

In `branch-form.tsx`:
- Add to the `Initial` type: `nameEn: string | null;`, `payslipNameEn: string | null;`, `payslipNameNative: string | null;`, `payslipLogoKey: string | null;`, `payslipLogoUrl: string | null;`.
- Add `import { BranchLogoField } from './branch-logo-field';` at the top.
- After the existing `name` `FormField`, add the English branch name field:

```tsx
            <FormField label="ชื่อสาขา (อังกฤษ)" htmlFor="nameEn" hint="แสดงให้พนักงานที่เลือกภาษาอื่นนอกจากไทย (ไม่บังคับ)">
              <Input id="nameEn" name="nameEn" maxLength={80} defaultValue={initial?.nameEn ?? ''} />
            </FormField>
```

- At the end of the `CardBody` (after the last checkbox block, before `</CardBody>`), add the letterhead section:

```tsx
            <div className="space-y-4 border-t border-gray-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-ink-1">หัวกระดาษสลิปเงินเดือน</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  ชื่อบริษัทและโลโก้ที่แสดงบนสลิปของพนักงานสาขานี้ — เว้นว่างเพื่อใช้ค่าเริ่มต้น (Koolman)
                </p>
              </div>
              <FormField label="ชื่อบริษัท (อังกฤษ)" htmlFor="payslipNameEn">
                <Input id="payslipNameEn" name="payslipNameEn" maxLength={120} defaultValue={initial?.payslipNameEn ?? ''} />
              </FormField>
              <FormField label="ชื่อบริษัท (ไทย/ภาษาท้องถิ่น)" htmlFor="payslipNameNative">
                <Input id="payslipNameNative" name="payslipNameNative" maxLength={120} defaultValue={initial?.payslipNameNative ?? ''} />
              </FormField>
              <FormField label="โลโก้" htmlFor="payslipLogoKey" hint="รูปสี่เหลี่ยม/วงกลม PNG หรือ JPG">
                <BranchLogoField
                  branchId={initial?.id ?? null}
                  initialKey={initial?.payslipLogoKey ?? null}
                  initialUrl={initial?.payslipLogoUrl ?? null}
                />
              </FormField>
            </div>
```

Note: the form doesn't currently receive the branch `id`. Add `id: string` to the `Initial` type and pass it from the edit page (Step 3); on create it's null.

- [ ] **Step 2: Extend the action schema + persistence**

In `src/app/(admin)/admin/settings/branches/actions.ts`:
- Add these fields to `BranchSchema`'s object (before the `.refine(...)`):

```ts
    nameEn: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((s) => (s ? s : null)),
    payslipNameEn: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((s) => (s ? s : null)),
    payslipNameNative: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((s) => (s ? s : null)),
    payslipLogoKey: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((s) => (s ? s : null)),
```

- In `readForm`, add to the parsed object: `nameEn: get('nameEn'),`, `payslipNameEn: get('payslipNameEn'),`, `payslipNameNative: get('payslipNameNative'),`, `payslipLogoKey: get('payslipLogoKey'),`.

`createBranch` / `updateBranch` already spread `parsed.data` into `prisma.branch.create/update`, so the four new fields persist automatically. The `serializableBranch` audit helper does not need them.

- [ ] **Step 3: Pass initial values from the edit page**

In `src/app/(admin)/admin/settings/branches/[id]/edit/page.tsx`:
- Add `nameEn: true, payslipNameEn: true, payslipNameNative: true, payslipLogoKey: true,` to the `prisma.branch.findUnique` `select`.
- Add `import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';`.
- Before the `return`, add: `const payslipLogoUrl = await resolveStoredImageUrl(branch.payslipLogoKey);`.
- In the `<BranchForm ... initial={{ ... }}>`, add: `id: branch.id,`, `nameEn: branch.nameEn,`, `payslipNameEn: branch.payslipNameEn,`, `payslipNameNative: branch.payslipNameNative,`, `payslipLogoKey: branch.payslipLogoKey,`, `payslipLogoUrl,`.

The `new/page.tsx` (create) passes no `initial`, so the create form renders empty defaults — no change needed beyond the `Initial` type now allowing the new fields (all read via `initial?.`).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx biome check "src/app/(admin)/admin/settings/branches"`
Expected: tsc exit 0; Biome no errors.

- [ ] **Step 5: Manual verification**

Start the app, open `/admin/settings/branches/<id>/edit`, set an English name + company names + upload a PNG logo, save. Re-open the edit page → values persist and the logo preview shows. Open a published employee's slip preview for that branch → header shows the new name/logo; a non-Thai-locale slip shows the English branch name in สาขา. (Existing branches with nothing set look unchanged.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/settings/branches"
git commit --no-verify -m "feat(branch): edit/create the payslip letterhead + English branch name"
```

---

### Task 10: Localize the branch name on LIFF employee pages

**Files:**
- Modify: `src/app/(liff)/liff/profile/page.tsx`
- Modify: `src/app/(liff)/liff/check-in/page.tsx`

**Interfaces:**
- Consumes: `localizedBranchName` (Task 2); `getLocale` from `next-intl/server` (profile) and the already-resolved `locale` (check-in).

- [ ] **Step 1: Localize the profile branch row**

In `src/app/(liff)/liff/profile/page.tsx`:
- Add imports: `import { getLocale } from 'next-intl/server';` (if not already present) and `import { localizedBranchName } from '@/lib/branch/localized-name';`.
- Add `nameEn: true` to the employee query's `branch: { select: { name: true } }` → `branch: { select: { name: true, nameEn: true } }`.
- Resolve the locale (await `getLocale()` alongside the existing fetch) and change `branchName: fullEmployee.branch.name,` to:

```ts
        branchName: localizedBranchName(fullEmployee.branch, await getLocale()),
```

- [ ] **Step 2: Localize the check-in branch list**

In `src/app/(liff)/liff/check-in/page.tsx` (`locale` is already resolved in the `Promise.all`):
- Add `import { localizedBranchName } from '@/lib/branch/localized-name';`.
- Add `nameEn: true` to the `prisma.branch.findMany` `select`.
- Change `branches={branchInfo.map((b) => ({ id: b.id, name: b.name }))}` to:

```tsx
      branches={branchInfo.map((b) => ({ id: b.id, name: localizedBranchName(b, locale) }))}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(liff)/liff/profile/page.tsx" "src/app/(liff)/liff/check-in/page.tsx"
git commit --no-verify -m "feat(liff): show the English branch name to non-Thai employees"
```

---

### Task 11: Full-suite verification

- [ ] **Step 1: Run the whole unit suite + typecheck + lint**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx biome check .`
Expected: all tests pass; tsc exit 0; Biome no errors (the pre-existing warnings in untouched files are fine).

- [ ] **Step 2: Verify the default path is byte-stable**

Confirm a branch with all four fields null renders the same header as before: `companyEn`/`companyNative` resolve to the Koolman constants and `logoHtml` is the SVG. (Covered by the Task 5 default test + the Task 4 header test.)

---

## Notes for the implementer

- **Why `logoSvg` carries an `<img>`:** the opt is a raw HTML string slotted into the header; passing an `<img data-uri>` instead of the SVG needs no renderer change.
- **Stale-logo trap:** do NOT add a process-level cache inside `resolveLetterhead`. The logo key is stable under `upsert`, so a global cache would keep serving the old image after an admin replaces it. Per-run de-dup in `warm.ts` is safe because it lives only for that one publish.
- **No cache invalidation:** changing a branch's letterhead must not touch the `payslips` storage bucket. Already-published slips stay frozen by design.
- **Orphaned logos:** replacing a logo uses the same key (`upsert`), so no orphans; deleting (clearing the field) leaves the object in the bucket — acceptable, matching the existing selfie/cert convention.
