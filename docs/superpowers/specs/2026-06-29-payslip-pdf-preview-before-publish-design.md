# Payslip PDF preview before publish — design

**Date:** 2026-06-29
**Status:** Approved (pending implementation plan)

## Problem

The per-employee detail modal (shipped in `2026-06-29-per-employee-payslip-review-publish`)
lets an admin review a Draft slip's **formula breakdown** before pressing
`เผยแพร่ + ส่งสลิป`. But the admin cannot see the **actual PDF** the employee will
receive until *after* publish — and publish is irreversible (fires a LINE push and
stamps advance/leave sweeps). The admin should be able to preview the rendered PDF
slip before that point.

This is blocked today because the entire PDF pipeline is built around **published**
slips: [getPayslipDocument](../../../src/lib/payslip/document.ts) hard-requires
`status: { in: ['Published', 'Locked'] }` and reads swept advances/leaves via
`deductedInPayrollId: payroll.id` — stamps that only exist *after* publish. So there
is no way to render that PDF for a Draft.

## Goals

- An admin can preview the rendered PDF slip for a **Draft** row, **embedded inline**
  in the existing per-employee detail modal, **before** pressing เผยแพร่.
- The preview is **byte-faithful** to what publish will produce (same renderer, same
  document-assembly logic, sourced from the same live-draft recompute).
- The preview is **lazy** (rendered only on explicit click) and **transient** (never
  persisted, never collides with the real published-slip cache).

## Non-goals

- No preview for Published/Locked rows (they keep the current frozen read-only view).
  Viewing the *issued* PDF from the admin side is a separate, out-of-scope idea.
- No bulk/whole-month PDF preview (N PDFs inline is impractical).
- No change to the employee-facing LIFF payslip PDF route or its storage caching.

## Decisions (locked during brainstorming)

1. **Embedded inline** in the detail modal (not new-tab, not download).
2. **Draft rows only.** Published/Locked rows are unchanged.
3. The preview route is gated by **`payroll.read`** — the same permission that already
   loads the modal's breakdown numbers (anyone who can see the breakdown can see its PDF).
4. **No storage persistence** for previews — render on-the-fly, stream the bytes; never
   write the `employeeId/month.pdf` key (that key is the real published slip).
5. **Faithful by shared assembler** — extract a pure `assemblePayslipDocument` used by
   both the published path and the preview path, so they can never diverge in layout.
6. **Lazy render** — the ~1.2s headless render only runs on an explicit "ดูตัวอย่าง PDF"
   click, never on modal open.

## Architecture

### A. Document source — extract a shared assembler

File: [src/lib/payslip/document.ts](../../../src/lib/payslip/document.ts)

`getPayslipDocument` currently mixes **gather** (status-gated query + stamped sweeps)
with **assemble** (building the `PayslipDocument` line structure). Split them:

```ts
// Pure — no DB. The single source of truth for slip layout/line construction.
export function assemblePayslipDocument(input: NormalizedPayslipInput): PayslipDocument;

type NormalizedPayslipInput = {
  meta: { employeeName; employeeId; branch; department; payType; month };
  buckets: {
    incomeBase: number; incomeOther: number;
    deductSso: number; deductAdvance: number; deductAttendance: number;
    deductLeave: number; deductDebt: number; deductOther: number;
    netPay: number;
  };
  adjustments: { kind: 'Income' | 'Deduction'; reason: string; amount: number }[];
  advanceAmounts: number[];       // for the advance line detail
  leaveOverMinutes: number[];     // for the leave over-quota detail
  leaveConfig: LeaveConfigShape | null; // for standardDayMinutes / perMinuteRate
};
```

`getPayslipDocument` (published) keeps its current gather, maps its results into
`NormalizedPayslipInput`, and calls `assemblePayslipDocument`. Behavior is unchanged
(the existing line-reconciliation rules — itemize adjustments only when they reconcile
to the bucket total, leave detail with minutes — move verbatim into the assembler).

### B. Preview document builder — from the live draft

File: [src/lib/payslip/preview.ts](../../../src/lib/payslip/preview.ts) (new)

```ts
export async function buildPreviewPayslipDocument(
  month: string,
  employeeId: string,
): Promise<PayslipDocument | null>;
```

Sources the **live draft** via the same calc gather behind `payrollRowDetail`
(`src/lib/payroll/run.ts`), maps the draft numbers + un-stamped advance/leave/adjustment
sources into `NormalizedPayslipInput`, and calls the shared `assemblePayslipDocument`.
Returns `null` when the employee has no computable draft for the month.

To avoid re-implementing the gather, `run.ts` exposes a raw (numbers, not serialized)
per-employee draft accessor that `buildPreviewPayslipDocument` consumes. (Implementation
note: either a new `payrollRowDetailRaw(month, employeeId)` returning numbers + line
sources, or refactor the existing serialized `payrollRowDetail` to build on that raw
shape. The plan picks one; the serialized `payrollRowDetail` behavior must not change.)

### C. Preview route — render on-the-fly, no persist

File: `src/app/(admin)/admin/payroll/preview-pdf/route.ts` (new)

```
GET /admin/payroll/preview-pdf?m=YYYY-MM&employeeId=<uuid>
```

- `runtime = 'nodejs'`, `maxDuration = 60` (matches the employee PDF route).
- Enforce `requirePermission('payroll.read')`.
- Validate `m` (MONTH_RE) and `employeeId` (UUID_RE) → 400 on bad input.
- `doc = await buildPreviewPayslipDocument(month, employeeId)`; if `null` → **404**.
- Render the SAME way the employee route does — `buildPayslipHtml(doc, {...})` →
  `renderPayslipPdf(html)` — reusing `fontFaceCss` / `payslipLogoSvg` /
  `payslipPeriodLabel` / `formatMoney`, with the admin's locale.
- Return the PDF **bytes inline**: `new NextResponse(buf, { headers: { 'Content-Type':
  'application/pdf', 'Content-Disposition': 'inline' } })`. **Do NOT** call
  `getOrRenderPayslipPdf` / Supabase storage — no caching, no `employeeId/month.pdf`
  write.
- On render error → log server-side + **500** (mirrors the employee route's catch).
- Audit: write a `payslip.preview` audit entry `{ source: 'admin-ui', month, employeeId }`.

### D. UI — embedded iframe in the detail modal

File: [src/app/(admin)/admin/payroll/row-detail.tsx](../../../src/app/(admin)/admin/payroll/row-detail.tsx)

In the **Draft** branch only, between the formula breakdown and the publish button:
- A `ดูตัวอย่างสลิป (PDF)` toggle button. First click sets `showPreview = true`.
- When shown, render `<iframe src="/admin/payroll/preview-pdf?m={month}&employeeId={employeeId}" />`
  sized to a readable height (e.g. `h-[60vh] w-full`), with a spinner overlay until the
  iframe's `onLoad` fires.
- Lazy: the iframe (and thus the render) mounts only after the toggle is clicked.
- The publish button and its `ConfirmDialog` stay exactly as they are, below the preview.
- Frozen (Published/Locked) branch: unchanged — no preview button.

## Error handling

- Bad input → 400; no row/not computable → 404; render failure → 500 (logged).
- The iframe is same-origin, so the modal can show a fallback (`ไม่สามารถแสดงตัวอย่าง
  สลิปได้`) with a retry that re-mounts the iframe, reusing the error/retry pattern from
  the detail-fetch (`row-detail.tsx`).
- A 404 (no computable draft) is rare in practice (the modal already loaded a draft to
  show the breakdown), but handled rather than left as a broken iframe.

## Faithfulness & caching

- The preview reflects the **live draft at click time** — if inputs change before
  publish, the published PDF differs. Same recompute-live semantics as the detail modal;
  the page's existing stale-draft banner covers drift.
- Preview renders are **never cached or persisted**. The published-slip storage cache
  (`getOrRenderPayslipPdf`, key `employeeId/month.pdf`) is untouched, so a preview can
  never be mistaken for or overwrite the issued slip.

## Components & interfaces summary

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `assemblePayslipDocument` (document.ts) | Pure: NormalizedPayslipInput → PayslipDocument | nothing |
| `getPayslipDocument` (document.ts) | Published gather → normalize → assemble (unchanged output) | assembler, prisma |
| `buildPreviewPayslipDocument` (preview.ts) | Live-draft gather → normalize → assemble | assembler, run.ts raw draft |
| `payrollRowDetailRaw` (run.ts) | One-employee draft numbers + line sources (not serialized) | gatherAndCalc |
| `preview-pdf/route.ts` | payroll.read gate, render inline PDF, no persist, audit | buildPreviewPayslipDocument, renderPayslipPdf |
| `row-detail.tsx` preview toggle | Lazy iframe embed + spinner + error/retry | the route |

## Data flow

```
Draft modal ─▶ click "ดูตัวอย่างสลิป (PDF)"
            ─▶ <iframe src=/admin/payroll/preview-pdf?m&employeeId>
                  │ (payroll.read gate)
                  ▼
        buildPreviewPayslipDocument(month, employeeId)   [null → 404]
                  │  (live draft via payrollRowDetailRaw → NormalizedPayslipInput)
                  ▼
        assemblePayslipDocument(input)  ── same assembler as published path
                  ▼
        buildPayslipHtml → renderPayslipPdf  ── inline PDF bytes (no storage)
                  ▼
             iframe displays the slip
```

## Testing

- **Unit (`document.test.ts`)**: `assemblePayslipDocument` — feed a normalized input and
  assert the exact `PayslipDocument` (income/deduct lines, totals, net). Include the
  adjustment-reconciliation branch (itemize only when adjustments sum to the bucket) and
  the leave over-quota detail. The faithfulness guarantee: the published and preview
  paths, given the same numbers, produce the same document — because they share this.
- **Integration (koolman_test, `payslip-pdf` or `payroll-pipeline`)**:
  `buildPreviewPayslipDocument(month, employeeId)` for a Draft employee returns a document
  whose `net` + bucket totals equal that employee's `payrollRowDetail` numbers; returns
  `null` for an employee with no computable row.
- **Reuse**: the HTML→PDF binary render is already covered by
  `payslip-pdf.integration.test.ts`; the preview uses that renderer unchanged, so no new
  PDF-binary test is added. The route's permission gate follows the existing admin-route
  gating pattern.
