# Per-branch payslip letterhead + localized branch name — design

**Date:** 2026-06-30
**Status:** Approved design, ready for implementation plan
**Owner:** Koolman Work (HR/payroll)

## 1. Goal

Two related improvements, both driven off the employee's **branch**:

1. **Per-branch payslip letterhead.** The top-left header of the payslip
   (company name in Thai + English, and the logo) is currently hardcoded to
   Koolman. Let each branch optionally set its own company name (native +
   English) and upload its own logo, shown on that branch's employees' slips.

2. **Localized branch name.** The branch's own location name (e.g. `เชียงใหม่`)
   is currently a single Thai string. Add an optional English branch name
   (e.g. "Chiang Mai") and show it to **non-Thai** employees in the payslip
   `สาขา` field and on their LIFF pages.

Both are additive and optional: a branch that sets nothing looks exactly as it
does today.

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Letterhead default | **Per-branch fields are optional; null → today's hardcoded Koolman header** | Existing branches unchanged until customized; no migration backfill. |
| Name model | **Two separate concepts**: company letterhead (header) vs branch location name (`สาขา`) | They're different things — company identity vs where you work. |
| Letterhead names | **Both shown bilingually** (native + English line), as the header does today | Matches current header rendering; only the *values* become per-branch. |
| Branch name localization | **`locale === 'th' ? name : (nameEn || name)`** | "Non-Thai" employees see English; everyone else and any unset branch keeps the native name. |
| Logo input | **Uploaded raster image (PNG), square/round mark**, into the existing `~48×48` slot | Reuses the proven admin image-upload pattern; layout unchanged. |
| Logo in PDF | **Fetched server-side, embedded as a base64 `<img>`** (no network during render); null → existing inline SVG | Same "self-contained document" principle as the embedded fonts. |
| Cached slips | **Not retroactively rewritten** — only newly-rendered slips pick up changes | Published PDFs are immutable historical documents; avoids mass cache invalidation. |
| Data flow | **Resolve letterhead in the render/route layer**, keep `buildPayslipHtml` pure | Isolates the one bit of image I/O; centralizes defaults; render stays testable. |

## 3. Data model — `Branch` (4 new nullable columns)

```prisma
model Branch {
  // ... existing fields ...

  /// Payslip letterhead overrides. Null → fall back to the hardcoded
  /// Koolman default (COMPANY_EN / COMPANY_NATIVE / payslipLogoSvg()).
  payslipNameEn     String?   // English company name, e.g. "Koolman Co., Ltd."
  payslipNameNative String?   // Native company name, e.g. "บริษัท คูลแมน จำกัด"
  payslipLogoKey    String?   // storage key in `attendance-photos`, e.g.
                              // "{adminAuthUserId}/branch-logos/{branchId}.png"

  /// English variant of the branch's own location name. Null → fall back to
  /// `name`. Shown to non-Thai employees. `name` stays the unique identifier.
  nameEn            String?
}
```

Migration: additive, all nullable, **no backfill** (null is the documented
"use default" state). Follows the existing numbered-migration convention under
`prisma/migrations/`.

## 4. Resolver units (new, isolated, pure where possible)

### 4.1 `localizedBranchName(branch, locale)` — pure
`src/lib/branch/localized-name.ts`
```ts
export function localizedBranchName(
  branch: { name: string; nameEn: string | null },
  locale: string,
): string {
  return locale === 'th' ? branch.name : branch.nameEn || branch.name;
}
```
Used by payslip document assembly and every LIFF surface that shows the branch.

### 4.2 `resolveLetterhead(branch)` — async (image I/O)
`src/lib/payslip/letterhead.ts` (extends the existing file)
```ts
type LetterheadInput = {
  payslipNameEn: string | null;
  payslipNameNative: string | null;
  payslipLogoKey: string | null;
};
type ResolvedLetterhead = { companyEn: string; companyNative: string; logoHtml: string };

export async function resolveLetterhead(branch: LetterheadInput): Promise<ResolvedLetterhead>;
```
- `companyEn = payslipNameEn ?? COMPANY_EN` (existing default constant)
- `companyNative = payslipNameNative ?? COMPANY_NATIVE`
- `logoHtml = payslipLogoKey` present
  → download bytes via the **service-role** Supabase client, base64-encode,
    return `<img class="logo" width="48" height="48" src="data:image/png;base64,…">`
  → else `payslipLogoSvg()` (existing).
- Defaults `COMPANY_EN` / `COMPANY_NATIVE` move from `render-html.ts` into a
  shared export so both the resolver and the renderer reference one source.
- The logo download is memoizable per `payslipLogoKey` within a process; relevant
  for publish-warming (many employees share a branch). Implement a small
  in-module `Map` cache keyed by `payslipLogoKey`.

## 5. Render wiring

- **`buildPayslipHtml`** gains opts `companyEn: string` and `companyNative: string`,
  replacing the hardcoded `COMPANY_EN` / `COMPANY_NATIVE` in the header markup.
  `logoSvg` already accepts a string → it receives `logoHtml`.
- **Branch field localization.** `PayslipDocument.meta` carries **both** the
  native branch name (existing `branch`) and a new `branchEn: string | null`.
  The renderer chooses the `สาขา` value by locale:
  `locale === 'th' ? meta.branch : (meta.branchEn || meta.branch)`.
  (Document assembly stays locale-agnostic; the renderer already knows `locale`.)
- **Document assembly** (`src/lib/payslip/document.ts`, `preview.ts`): extend the
  branch `select` to `{ name, nameEn, payslipNameEn, payslipNameNative, payslipLogoKey }`
  and put the raw values on `meta`:
  - `meta.branch = branch.name`, `meta.branchEn = branch.nameEn`
  - `meta.letterhead = { payslipNameEn, payslipNameNative, payslipLogoKey }`
    — the raw fields incl. the logo **key** (a short string), **not** the base64
    blob, so the document stays lightweight and assembly does no image I/O.
- **Call-sites** (3) read `meta.letterhead` from the document, resolve it, and pass
  the opts — no separate branch query needed:
  - `src/app/(liff)/liff/payslip/pdf/route.ts`
  - `src/app/(admin)/admin/payroll/preview-html/route.ts`
  - `src/lib/payslip/warm.ts`
  Each does `const { companyEn, companyNative, logoHtml } = await resolveLetterhead(doc.meta.letterhead)`
  and passes `companyEn` / `companyNative` / `logoSvg: logoHtml` into `buildPayslipHtml`.

## 6. Admin UI + upload

- **Form** (`src/app/(admin)/admin/settings/branches/branch-form.tsx`):
  - New input: **English branch name** (`nameEn`, optional, maxLength ~80).
  - New **"สลิปเงินเดือน (Letterhead)"** section: company name (native), company
    name (English), and a **logo upload field** mirroring
    `src/app/(admin)/admin/employees/photo-field.tsx` (preview + replace/remove),
    writing the resulting storage key into a hidden input.
- **Upload helper** (`src/lib/storage/upload-selfie.ts` family): add
  `uploadBranchLogo(supabase, blob, adminAuthUserId, branchId | null)` →
  downscale to ≤256px square, encode **PNG** (preserve transparency), upload to
  `attendance-photos` at `{adminAuthUserId}/branch-logos/{branchId|new-rand}.png`,
  `upsert: true`. Mirrors `uploadEmployeePhoto`. (A `compressToPng` sibling of the
  existing `compressToJpeg` — logos are small, so no quality-step loop needed.)
- **Actions** (`src/app/(admin)/admin/settings/branches/actions.ts`): extend the
  zod schema + create/update to read and persist the 4 fields. Empty string → `null`.

## 7. Employee-page localization (requirement #2)

Apply `localizedBranchName(branch, locale)` wherever the branch label is shown to
an employee in their own locale:

- **Payslip `สาขา` field** — via the renderer's locale pick (§5).
- **LIFF profile** (`src/app/(liff)/liff/profile/page.tsx` → `profile-view.tsx`):
  set `branchName` using the resolved locale.
- **LIFF check-in** (`src/app/(liff)/liff/check-in/page.tsx`): if the branch name
  is shown to the employee, localize it too.

Admin-facing surfaces (admin console, admin-LIFF leave view) stay on `name` — they
are not the employee's own-locale context.

## 8. Fallback & caching

- Any null field → today's hardcoded Koolman default (`COMPANY_EN`,
  `COMPANY_NATIVE`, `payslipLogoSvg()`, branch `name`). **Existing branches render
  byte-identical** until an admin customizes them.
- **No retroactive rewrite.** Published slips are cached in the `payslips` bucket
  keyed by `employeeId/month`. A later letterhead/name change does **not**
  invalidate them; only slips rendered after the change reflect it. Drafts always
  reflect live values (previews are not cached).

## 9. Testing

- `localizedBranchName`: `th` → native; non-`th` + `nameEn` → English; non-`th` +
  null `nameEn` → native.
- `resolveLetterhead`: null fields → Koolman defaults + SVG logo; populated fields
  → overridden names + base64 `<img>` (storage download mocked); per-key memoization.
- `buildPayslipHtml`: renders `companyEn`/`companyNative` opts in the header; `สาขา`
  field localizes by locale (`th` vs non-`th`).
- Branch action: persists the 4 new fields; empty → null.
- Existing payslip render tests continue to pass with explicit default opts.

## 10. Out of scope

- App on-screen chrome / global branding outside the payslip + named LIFF surfaces.
- A company-wide default settings page (we fall back to the hardcoded default).
- Retroactive re-rendering of already-published slips.
- Logo shapes other than square/round marks (wide wordmarks, text-replacement logos).
