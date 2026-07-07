# Payslip Archive — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

Add browse + retrieval surfaces over the historical payslips the app already
generates: an **employee self-service "all my payslips" list** (LIFF), an
**admin per-employee payslip history with PDF download** (which admins cannot do
today), and an **admin bulk "download all of a month's payslips as a .zip"**.
Everything reuses the existing payslip pipeline — PDFs are already stored/cached
in Supabase Storage and lazily (re)rendered — so there is **no new rendering
logic**, only new browsing surfaces + two thin PDF/zip endpoints.

Scope is limited to **Published/Locked** payroll rows (frozen slips); Drafts are
never exposed, matching every existing surface.

## Context (what already exists)

- **Stored, cached PDFs.** `src/lib/payslip/storage.ts`: bucket `payslips`, key
  `keyFor(employeeId, month) = "${employeeId}/${month}.pdf"`.
  `getOrRenderPayslipPdf({ employeeId, month, render })` lists the bucket; on hit
  returns a 5-min signed URL, on miss calls `render()`, uploads (`upsert:true`),
  then signs. `invalidatePayslipPdf(employeeId, month)` is called fire-and-forget
  on re-publish (`src/lib/payroll/run.ts`). **`Payroll.pdfUrl` is vestigial —
  never written; do not use it.**
- **Render pipeline.** `getPayslipDocument(employeeId, month)` (`src/lib/payslip/document.ts`)
  reads the frozen `Payroll` row (`status ∈ {Published, Locked}`, else `null`);
  `buildPayslipHtml(doc, opts)` (`render-html.ts`); `renderPayslipPdf(html): Promise<Buffer>`
  (`pdf.ts`, `@sparticuz/chromium` + `puppeteer-core`, warm-browser singleton).
- **Existing employee PDF route:** `GET /liff/payslip/pdf?m=YYYY-MM`
  (`src/app/(liff)/liff/payslip/pdf/route.ts`) — `requireEmployee()`, always uses
  `employee.id`, 302-redirects to the signed URL from `getOrRenderPayslipPdf`,
  audits `payslip.download` (`source: 'liff'`). `runtime='nodejs'`, `maxDuration=60`.
- **Existing employee page:** `/liff/payslip?m=YYYY-MM` (`(liff)/liff/payslip/page.tsx`)
  — single month, `requireEmployee`, loads only Published/Locked, download button
  when a slip exists. Reached via a LINE flex deep-link (`liff.line.me?dest=payslip&m=…`).
  **No month list / navigator today.**
- **Existing admin access:** `/admin/payroll?m=YYYY-MM` (`payroll.read`) — per-row
  modal iframes the **HTML preview** `/admin/payroll/preview-html?m=…&employeeId=…`.
  **Admins have no PDF download and no bulk export.**
- **Locale.** `User.locale`; routes resolve primary + reference locale
  (`refLocale = locale === 'th' ? 'en' : 'th'`). The storage cache key is
  **locale-agnostic (first render wins)**; publish pre-warms each slip in the
  employee's own locale (`warmPublishedPayslips`).
- **Payroll history query shape:** `Payroll` has `@@unique([employeeId, month])`,
  `@@index([month])`; fields `month "YYYY-MM"`, `netPay`, `status`, `publishedAt`,
  `employee` relation. A per-employee archive query is
  `findMany({ where: { employeeId, status: { in: ['Published','Locked'] } }, orderBy: { month: 'desc' } })`.
- **Chromium bundling gotcha.** `next.config.ts` `outputFileTracingIncludes`
  force-bundles the chromium binary + fonts **per PDF route** (else the route
  500s on Vercel). It currently lists `/liff/payslip/pdf`,
  `/admin/reports/[report]/export`, and a **stale `/admin/payroll/preview-pdf`
  entry for a route that does not exist.** `serverExternalPackages` includes
  `@sparticuz/chromium` + `puppeteer-core`.

## Decisions

1. **Both audiences + bulk.** Employee "all my payslips" list; admin per-employee
   history + single download; admin bulk month zip.
2. **Published/Locked only** everywhere; Drafts never exposed.
3. **Employee list = the bare `/liff/payslip`;** `?m=` keeps its single-slip
   behavior so existing LINE deep-links still work.
4. **Per-employee admin history lives on the employee detail page**
   (`/admin/employees/[id]`); **bulk zip lives on the payroll month page**
   (`/admin/payroll?m=…`).
5. **Admin downloads render in the employee's own locale** (consistent with the
   pre-warmed cache).
6. **Reuse `payroll.read` + branch scope** for admin routes (no new permission);
   `requireEmployee` for the LIFF list.

## Non-goals (explicit YAGNI)

- Contracts / other document types (payslips only).
- A LIFF bulk zip (employees download one month at a time).
- On-demand regeneration UI from the archive (the publish flow owns rendering;
  re-publish already invalidates + re-warms).
- Date-range filters beyond the per-employee month list.
- Using/removing the vestigial `Payroll.pdfUrl` column (leave as-is; out of scope).

## Architecture

### A. Employee "all my payslips" list (LIFF)

- Modify `src/app/(liff)/liff/payslip/page.tsx`: when `?m=` is **absent**, render a
  **list** of the employee's Published/Locked months (newest first) — each row:
  Buddhist-era month label + `netPay` + a link to the existing
  `/liff/payslip/pdf?m=YYYY-MM`. When `?m=` is present, keep the current single
  slip view unchanged.
- Query (server component, `requireEmployee()`):
  `prisma.payroll.findMany({ where: { employeeId: employee.id, status: { in: ['Published','Locked'] } }, orderBy: { month: 'desc' }, select: { month: true, netPay: true } })`.
- **No new PDF route, no chromium config** for this half — the download reuses
  `/liff/payslip/pdf`.

### B. Admin per-employee history + single download

- **Loader** `src/lib/payslip/history.ts` (server-only):
  `loadEmployeePayslipHistory(employeeId): Promise<{ month: string; netPay: number }[]>`
  — the same Published/Locked query, newest first. (Pure list; branch-scope is
  enforced by the caller, which already loaded the employee within scope.)
- **UI:** a "สลิปเงินเดือน" section on `/admin/employees/[id]` listing the months
  with a per-month **Download PDF** link to the new route below.
- **Route** `src/app/(admin)/admin/payroll/payslip-pdf/route.ts`:
  `GET ?m=YYYY-MM&employeeId=<uuid>`, `runtime='nodejs'`, `maxDuration=60`.
  - Gate: `requirePermission('payroll.read')` + `getPermittedBranches`; load the
    employee, 404/403 unless in the caller's permitted branches. Validate `m`
    (`^\d{4}-(0[1-9]|1[0-2])$`) + `employeeId` (UUID_RE) → 400.
  - Resolve the employee's locale (default `'th'`), build the render closure
    mirroring the LIFF pdf route, call `getOrRenderPayslipPdf`, **302 → signed URL**.
    `null` document (no frozen slip) → 404.
  - Audit `payslip.download` with `source: 'admin-ui'`.

### C. Admin bulk month zip

- **Bytes helper** in `src/lib/payslip/storage.ts` (new, sibling to
  `getOrRenderPayslipPdf`):
  `getPayslipPdfBytes({ employeeId, month, render }): Promise<Buffer | null>` —
  download the object bytes from the bucket on a cache hit; on a miss `render()`,
  upload, return the buffer. (The single-download route keeps the signed-URL
  redirect; the zip needs raw bytes.)
- **Selection loader** `src/lib/payslip/history.ts`:
  `loadMonthPayslipTargets(month, permitted): Promise<{ employeeId; name; locale }[]>`
  — all employees with a Published/Locked payroll row that month, branch-scoped
  via `viaEmployeeBranchScope(permitted)`.
- **Route** `src/app/(admin)/admin/payroll/payslips-zip/route.ts`:
  `GET ?m=YYYY-MM` (optional `branchId`), `runtime='nodejs'`, `maxDuration=300`.
  - Gate `payroll.read` + branch scope; validate `m` → 400.
  - For each target: `getPayslipPdfBytes(...)` (skip nulls), add to a streaming
    zip as `<sanitized employeeName>_<month>.pdf`. Return the zip with
    `Content-Type: application/zip` + RFC-5987 `Content-Disposition`
    (`สลิปเงินเดือน_<month>.zip`), `Cache-Control: no-store`.
  - Audit `payslip.download` with `source: 'admin-ui-bulk'` + `count`.
  - **Zip utility:** the plan pins the exact lib — prefer a dependency already
    present; otherwise a small streaming zip (e.g. `archiver`). Confirm at plan time.
- **UI:** a "ดาวน์โหลดสลิปทั้งหมด (.zip)" `<a download>` on `/admin/payroll?m=…`,
  shown when the month has ≥1 Published/Locked slip.

### D. Chromium bundling config (`next.config.ts`)

- Add `outputFileTracingIncludes` entries for `/admin/payroll/payslip-pdf` and
  `/admin/payroll/payslips-zip` (both glob the fonts dir + both chromium bin
  paths, mirroring the existing `/liff/payslip/pdf` entry).
- **Remove the stale `/admin/payroll/preview-pdf` entry** (no such route exists) —
  targeted cleanup while editing this config.

## Performance

For a normally-published month, every slip's PDF was pre-warmed in the employee's
locale at publish time, so the bulk zip is **all cache hits → fast**. Only a
never-warmed month renders N PDFs via the warm-Chromium singleton, bounded by the
route's `maxDuration=300`. We accept this cold-path cost rather than build
pagination/async jobs (YAGNI); the zip route documents the tradeoff.

## Error / empty states

- Employee with no published slips → friendly empty list.
- Admin single download: no frozen slip → 404; employee out of branch scope → 403;
  malformed `m`/`employeeId` → 400.
- Bulk zip with no slips that month/scope → 404 (or an empty-state message on the
  page disables the button).

## Testing

- **Unit:**
  - History list mapper (Buddhist-era month label, `netPay` format, newest-first).
  - Zip entry-name builder (sanitizes employee name; `<name>_<month>.pdf`;
    de-dupes on name collision).
  - `employeeInPermittedBranches` guard (superadmin/global vs branch-scoped vs
    out-of-scope).
- **Integration:**
  - `loadEmployeePayslipHistory` — only Published/Locked, newest-first, excludes
    Drafts/other employees.
  - `loadMonthPayslipTargets` — correct employee set for a month, branch-scoped;
    excludes non-frozen.
- **Routes** (`payslip-pdf`, `payslips-zip`) verified via `tsc` + `lint` +
  manual; Chromium rendering is not unit-tested (heavy) — we test the
  selection/gating/query logic, not the render. `getPayslipPdfBytes` cache-hit
  path can be integration-tested by seeding a bucket object if practical;
  otherwise covered by the manual pass.

## Files

**New**
- `src/lib/payslip/history.ts` — `loadEmployeePayslipHistory`, `loadMonthPayslipTargets`.
- `src/app/(admin)/admin/payroll/payslip-pdf/route.ts` — admin single download.
- `src/app/(admin)/admin/payroll/payslips-zip/route.ts` — admin bulk zip.
- Admin employee-detail payslips section component (+ a bulk-download `<a>` on the
  payroll page).
- Tests: `src/lib/payslip/history.test.ts` (+ integration), zip-name-builder + guard unit tests.

**Modified**
- `src/app/(liff)/liff/payslip/page.tsx` — list view when `?m=` absent.
- `src/lib/payslip/storage.ts` — add `getPayslipPdfBytes`.
- `src/app/(admin)/admin/employees/[id]/…` — payslips section.
- `src/app/(admin)/admin/payroll/page.tsx` — bulk zip button.
- `next.config.ts` — two new tracing entries + remove the stale `preview-pdf` one.

## Phase 2 (deferred, no rework implied)

- LIFF bulk download / year zip for employees.
- Async/queued zip for very large branches (if cold-path zips ever time out).
- Contracts / other employee documents on the same archive surface.
