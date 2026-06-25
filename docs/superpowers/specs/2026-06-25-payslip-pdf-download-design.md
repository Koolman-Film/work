# Downloadable PDF payslip — design

**Date:** 2026-06-25
**Status:** Approved design (visual prototype validated), ready for implementation plan
**Owner:** Koolman Work (HR/payroll)

## 1. Goal

Let staff download a formal, professional PDF of their payslip — translated to
their own language with English alongside — from the LIFF payslip page. The PDF
must render correctly for every supported script (Thai, Khmer, Myanmar, Lao,
Chinese, English), repeat a header/footer across pages, and be archived so it can
be re-downloaded without re-rendering.

This complements the existing in-app slip (`/liff/payslip`) and the LINE
"Payslip available" Flex card; it does not replace them.

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Render engine | **HTML → headless Chromium** | Only engine that shapes Khmer/Myanmar/Lao correctly; trivial dual-language via HTML/CSS. (react-pdf rejected — weak complex-script shaping.) |
| Where it runs | **Server-side** (Vercel Node / Fluid Compute) | Required for the Storage archive; reliable download inside the LINE in-app browser. |
| Destination | **Device download + archive in Supabase Storage** (private `payslips` bucket), cache-first | Published slip is immutable → a PDF is a pure function of the payroll row; render once, reuse. |
| Dual-language | **Stacked**: native label over a smaller English line; English-only when locale = `en` | Matches the requirement; English line carries the editorial styling. |
| Letterhead | **Full formal** payslip (logo, employee block, earnings/deductions, net, closing mark) | A downloadable document should look official. |
| Layout | Summary strip + take-home bar + two-column earnings\|deductions + net hero | Validated in the prototype; uses A4 width well. |
| Header/footer | **Repeating header via `<thead>`; page footer pinned via `page.pdf` `footerTemplate`** (page numbers); disclaimer + seal as a one-time closing mark | thead keeps web fonts; footerTemplate pins to the physical bottom of every page incl. the last. |
| Deduction/earnings detail | A fine-print sub-line **when derivable** (data-driven, localized) | "Add detail if available." |
| Typography | Japanese-inspired: 藍 indigo + 朱 vermilion + 墨 ink + washi; hairlines; tracked **Latin-only** micro-labels; light numerals | Validated; see §6.4 for the letter-spacing safety rule. |
| Logo | Official Koolman seal raster if present, else inline SVG reproduction | Real artwork when available. |

The prototype generator `scripts/sample-payslip-pdf.mjs` is the visual reference
for this spec (throwaway — not shipped).

## 3. Architecture

```
LIFF payslip page ── "Download PDF" button (per visible month)
        │
        ▼
GET /liff/payslip/pdf?m=YYYY-MM           (Node runtime route handler)
        │  requireRole(['Staff'])  → session employee only
        ▼
getPayslipDocument(employeeId, month)     ── single source of truth (shared with the page)
        │  (returns null if no Published/Locked slip → 404)
        ▼
Storage cache check: payslips/{employeeId}/{month}.pdf
        │  hit ──────────────► sign download URL ──► 302 redirect
        │  miss
        ▼
buildPayslipHtml(doc, locale, t, tEn)  →  renderPdf(html)  (Chromium)
        ▼
upload to private bucket  →  sign download URL  →  302 redirect (forces download)
```

**Why cache-first + redirect:** the slip is frozen once `Published`/`Locked`, so
the rendered bytes never change. A Supabase **signed URL with `download`** set
makes the file save reliably even inside LINE's webview (a direct
`Content-Disposition` stream from the route is flaky there).

## 4. Components / files

New:
- `src/lib/payslip/document.ts` — `getPayslipDocument(employeeId, month)`: assembles the typed `PayslipDocument` (§5). The LIFF page is refactored to consume the same function so page and PDF cannot diverge.
- `src/lib/payslip/render-html.ts` — `buildPayslipHtml(doc, { locale, t, tEn, logo })`: pure string builder. No DB, no Chromium → unit-testable.
- `src/lib/payslip/fonts.ts` — resolves the `@font-face` block for a locale (Latin + that locale's script only; §6.3).
- `src/lib/payslip/pdf.ts` — `renderPdf(html): Promise<Buffer>` via `puppeteer-core` + `@sparticuz/chromium` (Vercel) / local Chrome (dev).
- `src/lib/payslip/storage.ts` — `getOrRenderPayslipPdf()` (cache get → render → put → signed URL); `invalidatePayslipPdf(employeeId, month)`.
- `src/app/(liff)/liff/payslip/pdf/route.ts` — `GET` handler (authz, 404, 302 to signed URL). `export const runtime = 'nodejs'`, `export const maxDuration = 60`.
- `prisma/migrations/<n>_payslips_bucket/migration.sql` — create the private `payslips` Storage bucket + RLS (mirrors `attendance-photos`).
- `messages/*.json` — new `payslipPdf` letterhead keys in all 6 locales.

Modified:
- `src/app/(liff)/liff/payslip/page.tsx` — add the "Download PDF" link/button (targets the current `?m=`); adopt `getPayslipDocument`.
- `src/lib/payroll/run.ts` (or the unlock/revise action) — call `invalidatePayslipPdf` when a published month is unlocked/revised (cache bust; §7).
- Bundle Noto font assets under `src/lib/payslip/fonts/` (or `public/fonts/payslip/`).

## 5. Data model — `PayslipDocument`

`getPayslipDocument` reads the frozen `Payroll` row (`Published`/`Locked` only)
plus the swept source records, and returns:

```ts
type PayslipLine = {
  key: string;                 // 'base' | 'sso' | 'leave' | adjustmentId | ...
  amount: string;              // formatted, 2dp
  detailKey?: string;          // i18n key for the fine-print note
  detailVars?: Record<string, string | number>;  // e.g. { pct: 5, cap: '15,000' }
};
type PayslipDocument = {
  meta: { employeeName; employeeId?; branch; department?; payType; month; period };
  income: { lines: PayslipLine[]; total: string };
  deduct: { lines: PayslipLine[]; total: string };
  net: string;
  generatedAt: string;         // Asia/Bangkok
};
```

**Reconciliation guard (kept from the page):** itemized lines are shown only when
their per-reason sum equals the frozen bucket total on the `Payroll` row; otherwise
the bucket is shown as a single line. The frozen `Payroll` numbers stay
authoritative.

### 5.1 Detail-line derivation (the "if available" rule)

| Bucket | Source for the detail | v1 |
|---|---|---|
| Base salary | pay type / working days | label only |
| SSO (`deductSso`) | `PayrollConfig` rate × cap → `5% · cap ฿15,000` | ✅ |
| Cash advance (`deductAdvance`) | `CashAdvance` where `deductedInPayrollId = payroll.id` → count/date | ✅ |
| Over-quota leave (`deductLeave`) | `LeaveRequest` where `deductedInPayrollId = payroll.id` → frozen `overQuotaMinutes` × per-minute rate | ✅ |
| Income other / Deduct other | `PayrollAdjustment` (month-window) per-reason, reconciled | ✅ (reason as the line label) |
| Attendance (`deductAttendance`) | per-day penalty breakdown from `Attendance` | ⏳ deferred — total only in v1 |
| Recurring/debt (`deductDebt`) | `RecurringDeduction` is **not** stamped with the payroll id | ⏳ deferred — total only in v1 (best-effort installment note is a follow-up) |

Deferred details simply render the bucket total with no sub-line — the "if
available" contract. No fabricated detail.

## 6. Rendering

### 6.1 HTML structure (running header/footer)
One `<table class="sheet">`:
- `<thead>` (`display:table-header-group`) = letterhead (logo, company, PAYSLIP + period). Repeats every page, keeps web fonts.
- `<tbody>` = summary strip, take-home bar, employee card, two-column earnings\|deductions cards (each with detail sub-lines under the amount), net hero, and the **closing mark** (disclaimer + ISSUED seal) once at the end.
- Footer: **not** in the table — drawn by `page.pdf`'s `footerTemplate` (company · generated-on · `Page X / Y`), pinned to the bottom margin of every page. `displayHeaderFooter:true`, empty `headerTemplate`, `margin: { top:'13mm', bottom:'15mm', left:'13mm', right:'13mm' }`.

### 6.2 Chromium on Vercel
`puppeteer-core` + `@sparticuz/chromium`; `runtime='nodejs'`, raised `maxDuration`.
Dev falls back to a local Chrome channel. `page.setContent(html, {waitUntil:'networkidle'})` → `await document.fonts.ready` → `page.pdf({format:'A4', printBackground:true, displayHeaderFooter:true, ...})`.

### 6.3 Fonts (per-locale, lean)
Bundle Noto Sans (Latin) + Noto Sans Thai / Lao / Myanmar / Khmer / SC. For a
request, inline **only** Latin + the request's script as base64 `@font-face`
(CJK — the large file — loads only for `zh-CN`). Fonts are bundled assets read at
render time (no external CDN dependency in prod). `font-variant-numeric:tabular-nums`
for all money columns.

### 6.4 Dual-language + the letter-spacing safety rule
Native label = primary (`.t1`, never letter-spaced). English = secondary micro-label
(`.t2`, `text-transform:uppercase; letter-spacing`). **Letter-spacing / uppercase is
applied ONLY to Latin (`.t2`/English) classes — never to `.t1` or any element
containing Thai/Khmer/Myanmar/Lao**, because tracking breaks their cluster shaping.
This is the single most important rendering invariant and gets an explicit test.

## 7. Storage

- Private bucket **`payslips`** (created by SQL migration, mirroring `attendance-photos`; service-role access, no public read).
- Object key: `payslips/{employeeId}/{YYYY-MM}.pdf`.
- Cache-first: render + upload on miss; reuse on hit.
- **Invalidation:** a `Published` month can return to `Draft` via `payroll.unlock`/`revise`. Those actions must call `invalidatePayslipPdf(employeeId, month)` (delete the object) so a re-published slip re-renders. A `Locked` month is terminal → never invalidated.
- Download: `createSignedUrl(key, ttl, { download: true })` (service-role client) → 302 redirect. TTL ~5 min.
- Lifecycle/retention: out of scope for v1 (objects are small and regenerable).

## 8. Security / authorization

- `requireRole(['Staff'])`; the route uses **the session employee's id only** — no `employeeId` request param, so a staff member can never fetch another's slip.
- Only `Published`/`Locked` months are downloadable (Drafts 404), same visibility rule as the page.
- Service-role client is server-only (existing `getSupabaseAdminClient`); the bucket is private; URLs are short-lived signed.
- Audit: optionally log `payslip.download` (decide in the plan; low value, skip if it adds noise).

## 9. i18n

Reuse existing `payslip.*` (income/deduction/net labels — already in all 6
locales). Add a `payslipPdf` namespace for letterhead + detail notes in all 6
locales: `employee, employeeId, payPeriod, payType, generatedOn, issued,
disclaimer, kept, download`, plus detail templates (`detail.sso`, `detail.leave`,
`detail.advance`, …). Numeric-heavy details interpolate values; units localized.

## 10. Error handling

- No published slip for the month → **404** (page hides the button when no slip).
- Chromium/render failure → **500** with a logged error; the in-app slip remains the fallback. No partial PDF is uploaded (render → buffer → upload is atomic per request).
- Storage upload failure → still return the freshly rendered bytes via a one-off signed URL is not possible (no object) → fall back to streaming the buffer with `Content-Disposition: attachment` and log the cache miss. (Cache is an optimization, not a correctness dependency.)
- Font load failure → render proceeds with the Latin fallback; logged.

## 11. Testing

- **Unit** (`document.ts`): reconciliation guard (itemize vs bucket), detail derivation from swept records, money formatting, net = income − deductions.
- **Unit** (`render-html.ts`): dual-language label builder; **asserts no letter-spacing/uppercase on native scripts**; detail line present only when `detailKey` set; English-only path for `en`.
- **Integration** (route): authz (only own, only Published/Locked), 404 path, cache hit skips render, cache miss renders+uploads, unlock invalidates.
- **PDF smoke** (per locale): generated bytes are a valid PDF (`%PDF`), ≥1 page, the locale's font is embedded, and a multi-row fixture produces the footer/page-number on each page. (Mirrors the prototype's checks.)

## 12. Open items / v1 scope

- **Attendance + recurring-debt details deferred** (§5.1) — total only.
- **Multi-page**: the two-column grid leaves an empty earnings box on page 2 when content spills. v1 keeps two columns (multi-page slips are rare); a follow-up can switch to single-column flow past N lines.
- **Footer page-number wording** ("Page X / Y") — Latin only by design (footerTemplate has no web fonts); acceptable.
- **Logo asset**: ship the official raster (or the SVG repro) under the app; `koolman-logo` lookup mirrors the prototype.

## 13. Rollout

Behind the existing payslip page; additive (new route + button). No schema
changes to business tables — only a Storage bucket migration. Ship → verify one
locale end-to-end in preview → confirm Chromium cold-start latency acceptable →
enable for all.
