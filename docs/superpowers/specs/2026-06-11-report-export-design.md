# Report Export (PDF / Excel / CSV) — Design Spec

Date: 2026-06-11
Status: Approved by user

## Goal

Add export to all three admin reports (attendance, leave, advance) in three formats:
PDF, Excel (.xlsx), and CSV. Files must be easy to read, match the Sapphire Editorial
design language, render Thai correctly, and respect the existing filters
(month/custom period, name search).

## Architecture

One shared export layer, three format writers, one route handler:

```
GET /admin/reports/[report]/export?format=pdf|xlsx|csv&m=YYYY-MM&from=&to=&q=
  ├─ requirePermission('report.read')        (same gate as report pages)
  ├─ resolvePeriod + existing query functions (src/lib/reports/queries.ts, unchanged)
  ├─ normalize → ExportTable                  (shared abstraction)
  └─ format writer (csv | xlsx | pdf)
```

- `[report]` ∈ `attendance | leave | advance`. Unknown report or format → 404/400.
- Route handler (GET) rather than server action: exports are downloads triggered by
  plain `<a href>` links and need `Content-Disposition` headers.
- Filename pattern: `รายงาน<ชื่อรายงาน>-<period>.<ext>` (e.g.
  `รายงานการมาทำงาน-2026-06.xlsx`), percent-encoded via `filename*` for Thai.

## ExportTable abstraction

```ts
type ExportColumn = {
  key: string;
  label: string;            // Thai header, same as on-screen tables
  align?: 'left' | 'right';
  format?: 'text' | 'int' | 'minutes' | 'thb';  // drives xlsx numFmt + pdf rendering
};

type ExportTable = {
  title: string;            // Thai report title
  periodLabel: string;      // Buddhist-era period label (same as PeriodPicker)
  generatedAt: string;      // Bangkok-tz timestamp
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
  totals?: Record<string, string | number>; // footer totals row
};
```

Each report has one mapper from its existing query row type to `ExportTable`:

- **Attendance**: fixed columns (employee, late count/minutes, early count/minutes,
  absent days, OT minutes) + totals row, mirroring the page footer.
- **Leave**: dynamic columns generated per active LeaveType (used / over-quota /
  deduction), plus remaining balance — same shape as the on-screen table.
- **Advance**: employee, approved-in-period, outstanding, available + totals for
  approved and outstanding.

All three writers consume `ExportTable`; adding a future report = one mapper.

## Format writers (`src/lib/export/`)

### CSV (`csv.ts`)
- Plain string with a UTF-8 BOM (`﻿`) prefix so Excel on Windows decodes Thai.
- RFC-4180 escaping (quotes around fields containing `, " \n`).
- Numbers raw (no ฿ symbol, no thousands separators) for machine-friendliness.

### Excel (`xlsx.ts`, exceljs)
- Title block: report title (bold, larger), period label, generated-at stamp.
- Header row: sapphire-600 fill (#3955E8), white bold text, frozen panes below it.
- Body: alternating-friendly default; `numFmt` per column format
  (`#,##0` int, `[฿]#,##0.00`-style THB via `"฿"#,##0.00`).
- Totals row: gray fill, bold, matching on-screen footer.
- Auto column widths from max content length (capped), font name "IBM Plex Thai"
  with Sarabun fallback handled by Excel itself.

### PDF (`pdf.tsx` template + `pdf.ts` renderer)
- A standalone HTML template (server-rendered string, not the app pages) styled with
  inline Sapphire tokens: sapphire header band with report title + period, ink color
  ramp for text, gray header/footer rows, totals row, page numbers, generated-at stamp.
- A4 landscape, repeating `<thead>` on page breaks.
- IBM Plex Thai regular + bold embedded via `@font-face` from base64 (font files
  checked into `src/lib/export/fonts/`) — lambda images have no Thai system fonts.
- Rendered with `puppeteer-core` + `@sparticuz/chromium`; local dev falls back to an
  installed Chrome via executable-path detection.

## UI

- Each report page adds an export action group in the existing `PageHeader` actions
  slot: three secondary-variant buttons (PDF / Excel / CSV) — simple `<a>` links to
  the export route carrying the current `?m=/from/to/q` search params.
- No client state; works with the server-rendered pages as-is.

## Runtime / Vercel

- Export route: `export const runtime = 'nodejs'`, `export const maxDuration = 60`.
- `next.config`: add `puppeteer-core`, `@sparticuz/chromium` to `serverExternalPackages`.
- Dependencies added: `exceljs`, `puppeteer-core`, `@sparticuz/chromium`.

## Error handling

- Invalid period params: same validation as report pages → 400.
- Empty results: still produce a valid file with headers + a "ไม่มีข้อมูล" row.
- Chromium launch failure: 500 with friendly Thai message; log via pino.

## Testing

- Unit tests for the three `ExportTable` mappers (column order, totals,
  Buddhist-era labels, formats).
- CSV writer: snapshot test incl. BOM and escaping.
- XLSX: write then re-parse with exceljs; assert headers, numFmt, totals.
- PDF: smoke test — route returns `application/pdf` with non-trivial length;
  skipped when Chromium unavailable (consistent with existing deferred-skip pattern).
- Permission test: export route 404s without `report.read`.

## Out of scope

- Branch/department filters (not yet surfaced in report UI).
- Admin-panel i18n (exports stay Thai, matching the admin pages).
- Streaming/pagination (headcount is bounded).
